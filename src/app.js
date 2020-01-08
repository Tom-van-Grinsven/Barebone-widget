const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const Ws = require('ws');
const cors = require('cors');
const controller = require('./rest/controller');
const { sentenceContainsWord, commandWords } = require('./util/voiceHelper');
require('dotenv').config();

const httpServer = http.createServer();
const app = express();

// Holds the (websocket) clients that are going to connect with your widget.
const clients = {};

// Values from the .env file.
const { WEBSOCKET_SERVER_ADDRESS, HTTP_PORT } = process.env;

httpServer.on('request', app);

app.use(bodyParser.json());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static('public'));

// Middleware function to bind the clients to the request.
app.use((req, res, next) => {
    req.clients = clients;
    next();
});

// Bind the controller to the root of your web server.
app.use('/', controller);

// Default error handling with Express.
app.use((err, req, res, next) => {
    console.error(`err: ${err}`);
    res.sendStatus(500);
    return next();
});

// This websocket server is used to bind the userId from the person using the widget to the clients object.
// This is done after the initial POST request in the controller.
// You can omit this if the data your widget is providing is publicly available and not user bound.
const wsServer = new Ws.Server({
    path: '/ws',
    noServer: true,
});

// The socket is bound to the user by his userId
wsServer.on('connection', socket => {
    socket.on('message', rawMessage => {
        const message = JSON.parse(rawMessage);
        let userId;

        switch (message.type) {
            case 'INIT':
                userId = message.payload;
                if (clients && clients[userId]) {
                    clients[userId].socket = socket;
                    socket.userId = userId;
                } else {
                    socket.close();
                }
                break;
            default:
                return;
        }
    });
});

// Is used to subscribe to biometric data and to receive this data.
const setupConnection = () => {
    return new Promise((resolve, reject) => {
        const wsClient = new Ws(WEBSOCKET_SERVER_ADDRESS);

        wsClient.on('open', () => {
            // You can subscribe on what types of biometric data you want by flipping the boolean values of the sub_ fields
            wsClient.send(
                JSON.stringify({
                    action: 'setWidget',
                    widgetId: 'YOUR_WIDGET_ID',
                    sub_emotion: false,
                    sub_face: false,
                    sub_gesture: false,
                    sub_voice: true,
                    sub_age: false,
                    sub_gender: false,
                })
            );
            resolve(wsClient);
        });

        wsClient.on('message', event => {
            const message = JSON.parse(event);
            // The message has a field called bioData which holds the biometric data and the userId of the person to which this data belongs.

            // An example of getting these values is described below
            const { userId, voice } = message.bioData;

            // Check if the command received includes the words you want your widget to respond to
            if (sentenceContainsWord(voice, commandWords, false)) {
                const client = clients[userId];

                // If a client has a socket, send a message to the frontend of your widget so it can update it's content
                if (client.socket) {
                    client.socket.send(
                        JSON.stringify({ type: 'THE UPDATE MESSAGE YOU WANT YOUR FRONTEND TO RESPOND TO' })
                    );
                }
            }
        });

        wsClient.on('close', event => {
            reject(event);
        });
        wsClient.on('error', event => {
            reject(event);
        });
    });
};

httpServer.on('upgrade', (req, networkSocket, head) => {
    wsServer.handleUpgrade(req, networkSocket, head, newWebSocket =>
        wsServer.emit('connection', newWebSocket, req)
    );
});

httpServer.listen(HTTP_PORT, async () => {
    await setupConnection();
    console.log(`http server listening on port: ${HTTP_PORT}`);
});


