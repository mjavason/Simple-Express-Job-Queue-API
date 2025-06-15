import express, { Request, Response, NextFunction } from 'express';
import 'express-async-errors';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import morgan from 'morgan';
import { setupSwagger } from './swagger.config';
import { Queue, Worker } from 'bullmq';
import { RedisOptions } from 'ioredis';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';

//#region App Setup
const app = express();

dotenv.config({ path: './.env' });
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(morgan('dev'));

setupSwagger(app, BASE_URL);

const redisOptions: RedisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

const emailQueue = new Queue('emailQueue', { connection: redisOptions });
new Worker(
  'emailQueue',
  async (job) => {
    const { to, subject, body } = job.data;
    console.log(`Sending email to ${to}, subject: ${subject}, body: ${body}`);

    // simulate delay
    const delay = Math.floor(Math.random() * 10000) + 1000; // 1s to 11s
    await new Promise((resolve) => setTimeout(resolve, delay));

    // randomly fail
    if (Math.random() < 0.9) {
      // 90% chance to fail
      console.log(`Failed to send email to ${to}`);
      throw new Error('Random email send failure');
    }

    console.log(`Email sent to ${to}`);
  },
  { connection: redisOptions, concurrency: 5 },
);

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});
serverAdapter.setBasePath('/admin/queues');

//#endregion App Setup

//#region Code here

/**
 * @swagger
 * /api/send-email:
 *   post:
 *     summary: Queue an email to be sent
 *     description: Adds an email job to the queue for asynchronous processing.
 *     tags: [Email]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *               - body
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               subject:
 *                 type: string
 *                 example: Welcome!
 *               body:
 *                 type: string
 *                 example: Hello, welcome to our service.
 *     responses:
 *       202:
 *         description: Email job queued successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: queued
 */
app.post('/api/send-email', async (req: Request, res: Response) => {
  const { to, subject, body } = req.body;
  await emailQueue.add(
    'send',
    { to, subject, body },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  );
  res.status(202).json({ status: 'queued' });
});

// View queue logs
app.use('/admin/queues', serverAdapter.getRouter());
//#endregion

//#region Server Setup

/**
 * @swagger
 * /api:
 *   get:
 *     summary: Call a demo external API (httpbin.org)
 *     description: Returns an object containing demo content
 *     tags: [Default]
 *     responses:
 *       '200':
 *         description: Successful.
 *       '400':
 *         description: Bad request.
 */
app.get('/api', async (req: Request, res: Response) => {
  try {
    const result = await axios.get('https://httpbin.org');
    return res.send({ message: 'Demo API called (httpbin.org)', data: result.status });
  } catch (error: any) {
    console.error('Error calling external API:', error.message);
    return res.status(500).send({ error: 'Failed to call external API' });
  }
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: API Health check
 *     description: Returns an object containing demo content
 *     tags: [Default]
 *     responses:
 *       '200':
 *         description: Successful.
 *       '400':
 *         description: Bad request.
 */
app.get('/', (req: Request, res: Response) => {
  return res.send({ message: 'API is Live!', envs: process.env });
});

/**
 * @swagger
 * /obviously/this/route/cant/exist:
 *   get:
 *     summary: API 404 Response
 *     description: Returns a non-crashing result when you try to run a route that doesn't exist
 *     tags: [Default]
 *     responses:
 *       '404':
 *         description: Route not found
 */
app.use((req: Request, res: Response) => {
  return res.status(404).json({ success: false, message: 'API route does not exist' });
});

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.log('\x1b[31m'); // red
  console.log(err.message);
  console.log('\x1b[0m'); // reset

  return res.status(500).send({ success: false, status: 500, message: err.message });
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
});
//#endregion
