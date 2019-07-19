const express = require('express');
const http = require('http');
const ws = require('ws');

const app = express();
app.use(express.json());
const users = [];


const server = http.createServer(app);

//Authentication of user
app.post('/login', function (req, res) {
  const body = req.body;
  if (!req.body.user) {
    res.status(400).send('Bad request');
  }
  if (users.includes(body.user)) {
    res.status(409).send('User with such name already exists');
  } else {
    users.push(body.user);
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
    } else {
      returnError(ws, 'Data not valid');
    }
  });
});


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
  console.log(user, text, date);
  if (!user || !text || !date) {
    return false;
  }
  return true;
};
