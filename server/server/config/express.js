import bluebird from 'bluebird';
import bodyParser from 'body-parser';
import compress from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import expressWinston from 'express-winston';
import httpStatus from 'http-status';
import logger from 'morgan';
import path from 'path';
import methodOverride from 'method-override';

import config from './config';
import errorHandler from './errorHandler';
import socketIo from './socket.io';
import winstonInstance from './winston';

import routes from '../routes/index.route';

/**@CronJobs - Email Analysis */
import { startReportCron } from "../emailAnalysis/jobs/report.job";
startReportCron();
import { startSyncJobs } from "../emailAnalysis/jobs/sync.job";
startSyncJobs();

/**@Rate limiter */
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 100,
  message: 'Too many requests from this IP, please try again after a minute'
});

global.logger = winstonInstance;
global.settings = {};

const app = express();

if (config.env === 'development') app.use(logger('dev'));

// parse body params and attach them to req.body
app.use(bodyParser.json({ limit: '50mb', type: 'application/json' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(cookieParser());
app.use(compress());
app.use(methodOverride());

// enable CORS
app.use(cors());

// enable detailed API logging in dev env
expressWinston.requestWhitelist.push('body');
expressWinston.responseWhitelist.push('body');
app.use(expressWinston.logger({
  winstonInstance,
  meta: true,
  msg: 'HTTP {{req.method}} {{req.url}} {{res.statusCode}} {{res.responseTime}}ms',
  colorStatus: true
}));

var rootFolder = require('path').resolve(__dirname, '..');
app.use('/images', express.static(path.join(rootFolder, 'upload')));

app.use('/api', routes);

app.get('', (req, res) => {
  res.json({ message: 'Executive Email Assistant API', status: 'running' });
});

// if error is not an instanceOf APIError, convert it.
app.use((err, req, res, next) => {
  errorHandler(err, req, res, next);
});

// catch 404
app.use((req, res) => {
  res.status(404).json({ errorCode: 404, errorMessage: 'Route not found' });
});

// log error in winston transports except when executing test suite
if (config.env !== 'test') app.use(expressWinston.errorLogger({ winstonInstance }));

// error handler, send stacktrace only during development
app.use((err, req, res, next) => // eslint-disable-line no-unused-vars
  res.status(err.status || 500).json({
    message: err.isPublic ? err.message : httpStatus[err.status],
    stack: config.env === 'development' ? err.stack : {}
  })
);

// initializing socket
let server = socketIo.init(app);

export default server;
