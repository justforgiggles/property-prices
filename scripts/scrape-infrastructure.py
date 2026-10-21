"""Short-lived Actions controller; credentials never enter droplet user data."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

TAG = "property-prices-scraper-1370448547"
REPOSITORY = "justforgiggles/property-prices"


def api(method, path, body=None):
    request = urllib.request.Request(
        "https://api.digitalocean.com/v2/" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + os.environ["DIGITALOCEAN_TOKEN"], "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            content = response.read()
            return json.loads(content) if content else None
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise RuntimeError(f"DigitalOcean {method} failed with HTTP {error.code}") from None


def delete(droplet_id, run_id=None):
    result = api("GET", f"droplets/{droplet_id}")
    if result is None:
        return
    tags = result["droplet"]["tags"]
    if TAG not in tags or (run_id is not None and f"scrape-run-{run_id}" not in tags):
        raise ValueError("Refusing to delete a droplet without matching ownership tags")
    api("DELETE", f"droplets/{droplet_id}")
    for _ in range(60):
        if api("GET", f"droplets/{droplet_id}") is None:
            print(f"Confirmed deletion of scraper droplet {droplet_id}", flush=True)
            return
        time.sleep(5)
    raise RuntimeError("Deletion not confirmed; refusing to provision another droplet")


def cleanup():
    marker = json.loads(Path("data/scrape-completed.json").read_text())
    droplet_id = marker["droplet_id"]
    run_id = marker["run_id"]
    if type(droplet_id) is not int or droplet_id <= 0 or not isinstance(run_id, str) or not all(part.isdigit() for part in run_id.split("-")):
        raise ValueError("Invalid completion record")
    delete(droplet_id, run_id)


def start():
    for name in ("DIGITALOCEAN_TOKEN", "SCRAPE_DEPLOY_KEY", "OXYLABS_USERNAME", "OXYLABS_PASSWORD"):
        if not os.environ.get(name):
            raise ValueError(f"Missing secret: {name}")
    # Delete one page at a time so pagination cannot skip resources after deletion.
    while True:
        droplets = api("GET", f"droplets?tag_name={TAG}&per_page=100")["droplets"]
        if not droplets:
            break
        for droplet in droplets:
            delete(droplet["id"])
    run_id = os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for name in ("access", "host"):
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / name)], check=True)
        cloud = {
            "ssh_authorized_keys": [(root / "access.pub").read_text().strip()],
            "ssh_keys": {"ed25519_private": (root / "host").read_text(), "ed25519_public": (root / "host.pub").read_text()},
            "ssh_pwauth": False,
        }
        result = api("POST", "droplets", {
            "name": f"property-scrape-{run_id}", "region": "lon1", "size": "s-1vcpu-2gb",
            "image": "ubuntu-24-04-x64", "tags": [TAG, f"scrape-run-{run_id}"],
            "backups": False, "ipv6": False, "user_data": "#cloud-config\n" + json.dumps(cloud),
        })
        droplet_id = result["droplet"]["id"]
        print(f"Created scraper droplet {droplet_id} for run {run_id}", flush=True)
        # A failed setup is retained for inspection and removed at the next start.
        address = None
        for _ in range(60):
            droplet = api("GET", f"droplets/{droplet_id}")["droplet"]
            addresses = [item["ip_address"] for item in droplet["networks"]["v4"] if item["type"] == "public"]
            if addresses and droplet["status"] == "active":
                address = addresses[0]
                break
            time.sleep(5)
        if address is None:
            raise RuntimeError("Droplet did not become active")
        (root / "known_hosts").write_text(address + " " + (root / "host.pub").read_text())
        ssh = ["ssh", "-i", str(root / "access"), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={root / 'known_hosts'}", "-o", "ConnectTimeout=10", f"root@{address}"]
        for attempt in range(30):
            if subprocess.run([*ssh, "true"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            if attempt == 29:
                raise RuntimeError("SSH never became available")
            time.sleep(5)
        subprocess.run([*ssh, "cloud-init status --wait"], check=True, timeout=300)
        # Obtain GitHub's published SSH host keys over authenticated HTTPS, not ssh-keyscan.
        with urllib.request.urlopen("https://api.github.com/meta", timeout=30) as response:
            github_keys = json.load(response)["ssh_keys"]
        files = {
            "/root/.ssh/scrape-deploy": os.environ["SCRAPE_DEPLOY_KEY"],
            "/root/.ssh/known_hosts": "".join("github.com " + key + "\n" for key in github_keys),
            "/root/scrape.env": "\n".join(f"{key}={shlex.quote(value)}" for key, value in {
                "OXYLABS_USERNAME": os.environ["OXYLABS_USERNAME"], "OXYLABS_PASSWORD": os.environ["OXYLABS_PASSWORD"],
                "SCRAPE_RUN_ID": run_id, "SCRAPE_DROPLET_ID": str(droplet_id),
            }.items()) + "\n",
        }
        for path, content in files.items():
            subprocess.run([*ssh, f"umask 077; cat > {shlex.quote(path)}"], input=content, text=True, check=True)
        sha = os.environ["GITHUB_SHA"]
        if len(sha) != 40 or any(c not in "0123456789abcdef" for c in sha):
            raise ValueError("Invalid source revision")
        bootstrap = f"""set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl xz-utils ca-certificates
cd /tmp
curl --fail --retry 3 -sSO https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz
curl --fail --retry 3 -sSO https://nodejs.org/dist/v22.22.0/SHASUMS256.txt
grep ' node-v22.22.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
tar -xJf node-v22.22.0-linux-x64.tar.xz --strip-components=1 -C /usr/local
export GIT_SSH_COMMAND='ssh -i /root/.ssh/scrape-deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes'
git clone git@github.com:{REPOSITORY}.git /opt/property-prices
cd /opt/property-prices
git checkout -B main {sha}
git clone git@github.com:{REPOSITORY}.git /opt/scrape-publish
git -C /opt/scrape-publish checkout -B main {sha}
systemd-run --unit=property-scraper --property=Restart=no --property=RuntimeMaxSec=90000 /bin/bash /opt/property-prices/scripts/scrape-worker.sh
"""
        subprocess.run([*ssh, "bash -s"], input=bootstrap, text=True, check=True, timeout=600)
        print("Detached scraper started; this GitHub job can now finish", flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "start":
        start()
    elif sys.argv[1] == "cleanup":
        cleanup()
    else:
        raise ValueError("Expected start or cleanup")
