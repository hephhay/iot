import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import { MongoClient } from 'mongodb';
import z from 'zod';

// MongoDB connection URL
const mongoUrl = process.env.MONGO_URL!;

const userData = z.object({
  action: z.string(),
  tank_id: z.number().int(),
  refill: z.boolean()
});

// type for tank data
const TankData = z.object({
    tank_id: z.number().int(),
    initial_level: z.number(),
    current_level: z.number(),
    refilling: z.boolean(),
});

const IOTInput = z.object({
  action: z.string(),
  tanks_info: z.array(TankData)
});

// Create an Express app
const app = express();

// MongoDB client and database
const mongoClient = await MongoClient.connect(mongoUrl);
console.log('Connected to MongoDB');
const db = mongoClient.db();

// Clients map (key: tankid, value: WebSocket[])
const clients: { [tankid: string]: WebSocket[] } = {};
let adminClients: WebSocket[] = [];

let iotClient: WebSocket | undefined = undefined;

// Create an HTTP server
const server = http.createServer(app);
const wss = new WebSocketServer({server});

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('new connection', req.url);
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
    iotClient = ws;
    // Handle incoming messages
    ws.on('message', async (message) => {
      console.log('received: %s', message);
      const iotInputData = (
        await IOTInput.safeParseAsync(JSON.parse(message.toString())));

      const tankData = iotInputData.data;
      if (!tankData) {
        console.error('Invalid data', iotInputData.error.message);
        // send invalid data response
        ws.send(JSON.stringify({
          status: "error",
          message: "Invalid data",
          details: iotInputData.error
        }));
        return;
      }

      const data = tankData.tanks_info;
      const collection = db.collection('tanks');

      // Save the data to MongoDB
      await collection.insertMany(data);
      for (const tankdata of data) {
        const tankid = tankdata.tank_id;

        // Broadcast data to connected clients for the same tankid
        if (!clients[tankid]) {
          clients[tankid] = [];
        }
        clients[tankid].forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(tankdata));
          }
        });

        // Broadcast data to connected admin clients
        adminClients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
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

// Set up Json body parser
app.use(express.json());

// Handle REST API requests
app.get('/tanks', async (req, res) => {
  const collection = db.collection('tanks');
  const tanks = await collection.find().toArray();
  res.json(tanks);
});

// Handle Health Check
app.get('/', async(req, res) => {
  res.json({status: "okay"})
})

app.post('/tanks', async (req, res) => {
  const data = req.body;
  console.log('received:', data);
  const inputData = (await userData.safeParseAsync(data));

  if (!inputData.data) {
    console.error('Invalid data', inputData.error.message);
    res.status(422).json({
      status: "error",
      message: "Invalid data",
      details: inputData.error
    });
    return;
  }

  if (!iotClient) {
    res.status(400).json({
      status: "error",
      message: "IoT device not connected"
    });
    return;
  }

  iotClient.send(JSON.stringify(data));
  res.json({status: "success"});
});

//404 handler
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Not found"
  });
});

server.listen(process.env.PORT || 3000, async () => {
  console.log('Server is running on port 3000');
});
