import winston from 'winston';
require('winston-daily-rotate-file');

import config from './config';

var transportConsole = new winston.transports.Console({
  json: true,
  timestamp: true,
  prettyPrint: true,
  colorize: true,
  level: 'info',
});

var transportDateDebug = new winston.transports.DailyRotateFile({
  json: true,
  timestamp: true,
  prettyPrint: true,
  colorize: true,
  level: 'info',
  filename: 'logs/debug/%DATE%log',
  datePattern: 'YYYY-MM-DD.',
  prepend: true
});

var transportDateException = new winston.transports.DailyRotateFile({
  filename: 'logs/exceptions/%DATE%log',
  datePattern: 'YYYY-MM-DD.',
  prepend: true
});

var logger = winston.createLogger({
  levels: {
    info: 2,
    warn: 1,
    error: 0,
    verbose: 3,
    i: 4,
    db: 5
  },
  transports: [
    transportConsole,
    transportDateDebug,
  ],
  exceptionHandlers: [
    transportConsole,
    transportDateException
  ],
  exitOnError: false
});

winston.addColors({
  info: 'green',
  warn: 'cyan',
  error: 'red',
  verbose: 'blue',
  i: 'gray',
  db: 'magenta'
});

function checkValidLog(type) {
  let process = false;
  if (type && config.isLoggerValidEnable) {
    if (global.settings && global.settings.logs) {
      if (global.settings.logs.indexOf(type) !== -1) {
        process = true;
      }
    } else {
      process = true;
    }
  } else {
    process = true;
  }
  return process;
}

function traceCaller(n) {
  if (isNaN(n) || n < 0) n = 1;
  n += 1;
  var s = (new Error()).stack,
    a = s.indexOf('\n', 5);
  while (n--) {
    a = s.indexOf('\n', a + 1);
    if (a < 0) { a = s.lastIndexOf('\n', s.length); break; }
  }
  let b = s.indexOf('\n', a + 1); if (b < 0) b = s.length;
  a = Math.max(s.lastIndexOf(' ', b), s.lastIndexOf('/', b));
  b = s.lastIndexOf(':', b);
  s = s.substring(a + 1, b);
  return s;
}

let logger_info_old = logger.info;
logger.info = async function (msg, type) {
  if (checkValidLog(type)) logger_info_old(traceCaller(1) + " : " + msg);
};

let logger_debug_old = logger.debug;
logger.debug = function (msg, type) {
  if (checkValidLog(type)) return logger_debug_old(traceCaller(1) + " : " + msg);
};

let logger_error_old = logger.error;
logger.error = function (msg, type) {
  if (checkValidLog(type)) return logger_error_old(traceCaller(1) + " : " + msg);
};

let logger_warn_old = logger.warn;
logger.warn = function (msg, type) {
  if (checkValidLog(type)) return logger_warn_old(traceCaller(1) + " : " + msg);
};

export default logger;
