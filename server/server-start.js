require("dotenv").config();
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.ENVIRONMENT = process.env.ENVIRONMENT || "local";
require("@babel/register");
require("@babel/polyfill");
const appModule = require("./server/index");
const configModule = require("./server/config/config");

const app = appModule.default || appModule;
const config = configModule.default || configModule;

app.listen(config.port, () => {
  console.info(`Executive Email Assistant server started on port ${config.port} (${config.env})`);
});
