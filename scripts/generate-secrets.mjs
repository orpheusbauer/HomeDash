#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

console.log('HOMEDASH_ADMIN_PIN=0000');
console.log(`HOMEDASH_SENSOR_INGEST_TOKEN=${randomBytes(32).toString('hex')}`);
console.log(`HOMEDASH_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`);
