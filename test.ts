import express from 'express';
import http from 'http';
import WebSocket from 'ws';

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
    ws.on('message', (message: string) => {
        console.log(message);
        ws.send('Tobi from thoughtbot fusion team.');
    });
});

app.get('/', (req: express.Request, res: express.Response) => res.send('Hello World!'));

server.listen(3000, () => console.log(`Listening on port :9000`));
