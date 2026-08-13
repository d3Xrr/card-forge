import { access, copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginId = 'ttrpg-card-forge';
const releaseFiles = ['main.js', 'manifest.json', 'styles.css'];
const defaultConfigDirectory = ['.', 'obsidian'].join('');
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const configPath = join(repositoryRoot, 'dev.config.json');

let config;
try {
	config = JSON.parse(await readFile(configPath, 'utf8'));
} catch (error) {
	console.error(
		'Could not read dev.config.json. Copy dev.config.example.json and set vaultPath.',
	);
	throw error;
}

if (typeof config.vaultPath !== 'string' || config.vaultPath.trim().length === 0) {
	throw new TypeError('dev.config.json must contain a non-empty vaultPath string.');
}

const vaultPath = resolve(config.vaultPath);
await access(vaultPath);

const destination = join(vaultPath, defaultConfigDirectory, 'plugins', pluginId);
await mkdir(destination, { recursive: true });

for (const fileName of releaseFiles) {
	const source = join(repositoryRoot, fileName);
	await access(source);
	await copyFile(source, join(destination, fileName));
}

process.stdout.write(`Deployed ${pluginId} to ${destination}\n`);
