import express, { Request, Response } from 'express';
import WebSocket, { Server as WebSocketServer } from 'ws';
import http from 'http';
import { MongoClient, Db } from 'mongodb';

// MongoDB connection URL
const mongoUrl = process.env.MONGO_URL!;

// Interface for tank data
interface TankData {
  [tankid: string]: {
    level: number;
    refill: boolean;
  };
}

// Create an Express app
const app = express();

// MongoDB client and database
let mongoClient: MongoClient;
let db: Db;

// Clients map (key: tankid, value: WebSocket[])
const clients: { [tankid: string]: WebSocket[] } = {};
let adminClients: WebSocket[] = [];

// Create an HTTP server
const server = http.createServer(app);
const wss = new WebSocketServer({server});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('new connection', req.url)
  const url = req.url;

  // Handle client connections
  if (url && url.startsWith('/tanks/')) {
    const tankid = url.replace('/tanks/', '');

    // Add the client to the clients map
    if (!clients[tankid]) {
      clients[tankid] = [];
    }
    clients[tankid].push(ws);

    // Handle client disconnections
    ws.on('close', () => {
      clients[tankid] = clients[tankid].filter((c) => c !== ws);
    });
  }
  //Handle Admin connections
  else if (url === '/admin') {
    adminClients.push(ws);

    // Handle admin disconnections
    ws.on('close', () => {
      adminClients = adminClients.filter((c) => c !== ws);
    });
  }
  // Handle IoT device connections
  else if (url === '/iot') {
    // Handle incoming messages
    ws.on('message', async (message) => {
      const data: TankData = JSON.parse(message.toString());
      const collection = db.collection('tanks');

      for (const tankid in data) {
        // Save the data to MongoDB
        await collection.insertMany([{ tankid, ...data[tankid] }]);

        // Broadcast data to connected clients for the same tankid
        if (!clients[tankid]) {
          clients[tankid] = [];
        }
        clients[tankid].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ [tankid]: data[tankid] }));
          }
        });

        // Broadcast data to connected admin clients
        adminClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ [tankid]: data[tankid] }));
          }
        });
      }
    });
  }
  // Handle unknown connections
  else {
    ws.close();
  }
});

// Handle REST API requests
app.get('/tanks', async (req: Request, res: Response) => {
  const collection = db.collection('tanks');
  const tanks = await collection.find().toArray();
  res.json(tanks);
});

server.listen(process.env.PORT || 3000, async () => {
  mongoClient = await MongoClient.connect(mongoUrl);
  console.log('Connected to MongoDB');
  db = mongoClient.db();
  console.log('Server is running on port 3000');
});
