const express = require('express');
const http = require('http');
const ws = require('ws');
var cors = require('cors');
const winston = require('winston');

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log' })
  ]
});

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

const users = new Map();
const inactivityTimeout = process.env.INACTIVITY_TIMEOUT || 30 * 1000;

//Authentication of user
app.post('/login', function(req, res) {
  const body = req.body;
  if (!req.body.user) {
    logger.error({
      url: req.originalUrl,
      ip: req.ip,
      status: 400,
      error: 'Bad request'
    });
    return res.status(400).send('Bad request');
  }
  if (users.has(body.user)) {
    logger.warn({
      url: req.originalUrl,
      ip: req.ip,
      status: 409,
      error: 'User with such name already exists'
    });
    return res.status(409).send('User with such name already exists');
  } else {
    users.set(body.user, { ws: null, timeout: null });
    logger.info({
      url: req.originalUrl,
      ip: req.ip,
      status: 200,
      text: `${body.user} succesfully logged in`
    });
    return res.send({ user: body.user });
  }
});

//initialize the WebSocket server instance
const wss = new ws.Server({ server: server, path: '/ws' });

/*Message format
{
          type: 'message',
          user: 'userName',
          text: 'USer Message',
          date: { formatted: 'yesterday', timestamp: 123123213 }
        }
*/

wss.on('connection', (ws, req) => {
  const current_url = new URL(req.headers.host + req.url);
  const userName = current_url.searchParams.get('user');
  ws.userName = userName;

  logger.info({ user: userName, status: 'conected' });
  broadcastMessage(ws, {
    type: 'clientStatus',
    text: `${userName} joined the chat.`,
    date: { timestamp: Date.now(), formatted: new Date().toDateString() }
  });

  const user = users.get(userName);
  user.ws = ws;
  user.timeout = createNewTimeout(userName);

  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', message => {
    let messageObj;
    try {
      messageObj = JSON.parse(message);
    } catch (e) {
      returnError(ws, 'Not valid JSON');
      return false;
    }
    if (isValidMessage(messageObj)) {
      ws.send(
        JSON.stringify({
          type: 'status',
          status: 'Success'
        })
      );
      broadcastMessage(ws, messageObj);
      resetInactivityTimer(user, userName);
    } else {
      returnError(ws, 'Data not valid');
    }
  });

  ws.on('close', () => {
    users.delete(userName);
    logger.info({ user: userName, status: 'disconnected' });
    broadcastMessage(ws, {
      type: 'clientStatus',
      text: `${userName} has left the chat.`,
      date: { timestamp: Date.now(), formatted: new Date().toDateString() }
    });
  });
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
      users.delete(userName);
      logger.info({ user: userName, status: 'conection lost' });
      broadcastMessage(ws, {
        type: 'clientStatus',
        text: `${ws.userName} left chat, connection lost.`,
        date: { timestamp: Date.now(), formatted: new Date().toDateString() }
      });
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);

server.listen(process.env.PORT || 3001, () => {
  logger.log('info', `Server started on port ${server.address().port}`);
});

process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

const returnError = (ws, errorText) => {
  ws.send(
    JSON.stringify({
      type: 'status',
      stauts: 'Error',
      text: errorText
    })
  );
};

const broadcastMessage = (ws, message) => {
  wss.clients.forEach(function each(client) {
    if (client !== ws && client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
};

const isValidMessage = ({ user, text, date }) => {
  if (!user || !text || !date) {
    return false;
  }
  return true;
};

const disconnectUser = userName => {
  const user = users.get(userName);
  if (user) {
    clearInterval(user.timeout);
    user.ws.close();
    users.delete(userName);
    logger.info({ user: userName, status: 'disconnected due to inactivity' });
    broadcastMessage(user.ws, {
      type: 'clientStatus',
      text: `${userName} was disconnected due to inactivity.`,
      date: { timestamp: Date.now(), formatted: new Date().toDateString() }
    });
  }
};

const createNewTimeout = userName => {
  return setTimeout(() => disconnectUser(userName), inactivityTimeout);
};

const resetInactivityTimer = (userObj, userName) => {
  clearInterval(userObj.timeout);
  userObj.timeout = createNewTimeout(userName);
};

function noop() {}

function shutDown() {
  logger.info('Server is starting to shut down');
  setTimeout(() => {
    logger.error('Shutting down took to long, terminating.');
    process.exit(1);
  }, 10000).unref();
  server.close(() => {
    logger.info('Server has been shut down');
    process.exit();
  });
}
