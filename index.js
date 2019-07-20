const express = require('express');
const http = require('http');
const ws = require('ws');
const url = require('url');

const app = express();
app.use(express.json());
const users = new Map();
const inactivityTimeout = process.env.INACTIVITY_TIMEOUT || 30 * 1000;


const server = http.createServer(app);

//Authentication of user
app.post('/login', function (req, res) {
  const body = req.body;
  if (!req.body.user) {
    res.status(400).send('Bad request');
  }
  if (users.keys.includes(body.user)) {
    res.status(409).send('User with such name already exists');
  } else {
    users.set(body.user, {ws: null, timeout: null});
    res.send({ user: body.user });
  }
});

//initialize the WebSocket server instance
const wss = new ws.Server({ server: server, path: '/ws' });

/*Message format
{
          type: 'message',
          user: "userName",
          text: "USer Message",
          date: { formatted: 'yesterday', timestamp: 123123213 }
        }
*/


wss.on('connection', (ws, req) => {
  


  const current_url = new URL(req.headers.host + req.url);
  const url_params = current_url.searchParams;
  const userName = url_params.get('user');

  //todo remove 
  users.set(userName, {ws: null, timeout: null});

  const user = users.get(userName);
  user.ws = ws;
  user.timeout = createNewTimeout(userName);

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', message => {
    let messageObj;
    try {
      messageObj = JSON.parse(message);
    } catch (e) {
      returnError(ws, 'Not valid JSON');
      return false;
    }
    if (isValidMessage(messageObj)) {
      ws.send(JSON.stringify({
        type: 'status',
        status: 'Success'
      }));
      broadcastMessage(ws, message);
      resetInactivityTimer(user, userName);
    } else {
      returnError(ws, 'Data not valid');
    }
  });
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping(noop);
  });
}, 30000);


server.listen(process.env.PORT || 3001, () => {
  console.log(`Server started on port ${server.address().port} :)`);
});

const returnError = (ws, errorText) => {
  ws.send(JSON.stringify({
    type: 'status',
    stauts: 'Error',
    text: errorText
  }));
}

const broadcastMessage = (ws, message) => {
  wss.clients.forEach(function each(client) {
    if (client !== ws && client.readyState === client.OPEN) {
      client.send(
        JSON.stringify(message)
      );
    }
  });
};

const isValidMessage = ({ user, text, date }) => {
  if (!user || !text || !date) {
    return false;
  }
  return true;
};

const disconnectUser = (userName) => {
  const user = users.get(userName);
  clearInterval(user.timeout);
  user.ws.close();
  users.delete(userName);
}

const createNewTimeout = (userName) => {
  return setTimeout(() => disconnectUser(userName), inactivityTimeout);
}

const resetInactivityTimer = (userObj, userName) => {
  clearInterval(userObj.timeout);
  userObj.timeout = createNewTimeout(userName);
}


const noop = () => {}

