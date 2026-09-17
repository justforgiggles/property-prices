import { http } from "@google-cloud/functions-framework";

import { predict } from "./inference.js";
import { valuation } from "./valuation.js";

http("predict", predict);
http("valuation", valuation);
