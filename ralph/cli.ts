#!/usr/bin/env node

/**
 * Ralph CLI entry point
 *
 * This is the bin entry for `npx ralph` / `npm install -g ralph`.
 * Delegates to runtime/cli.ts for all logic.
 */

import { readFile, writeFile } from 'fs/promises';
import { dispatch } from './runtime/cli.js';

const exitCode = await dispatch(process.argv.slice(2), {
  readFile: (path: string, encoding: 'utf-8') => readFile(path, encoding),
  writeFile: (path: string, content: string) => writeFile(path, content),
  cwd: process.cwd(),
  log: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg),
  importModule: (specifier: string) => import(specifier),
});

process.exit(exitCode);
