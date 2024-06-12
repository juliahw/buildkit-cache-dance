import fs from 'fs/promises';
import path from 'path';
import { CacheOptions, Opts, getCacheMap, getMountArgsString, getTargetPath } from './opts.js';
import { run } from './run.js';

async function extractCache(cacheSource: string, cacheOptions: CacheOptions, scratchDir: string) {
    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();

    await fs.mkdir(scratchDir, { recursive: true });
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const targetPath = getTargetPath(cacheOptions);
    const mountArgs = getMountArgsString(cacheOptions);

    const dancefileContent = `
FROM busybox:1
COPY buildstamp buildstamp
RUN --mount=${mountArgs} ls -al ${targetPath} && cp -p -R ${targetPath} /var/dance-cache/
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    // Build an image containing a tarball of the cache.
    await run('docker', ['buildx', 'build', '-f', path.join(scratchDir, 'Dancefile.extract'), '--tag', 'dance:extract', '--load', scratchDir]);

    // Extract the folder from the image.
    await fs.rm(cacheSource, { recursive: true, force: true });
    await fs.mkdir(cacheSource, { recursive: true });
    await run('docker', ['run', '-v', `${cacheSource}:/opt/mount`, '--rm', '--entrypoint', 'cp', 'dance:extract', '-p', '-R', '/var/dance-cache/', '/opt/mount/']);

    // Check if the cache is empty. If it is, remove the directory.
    const cacheFiles = await fs.readdir(cacheSource);
    if (cacheFiles.length === 0) {
        console.log('Cache is empty. Removing to prevent cache upload.')
        await fs.rm(cacheSource, { recursive: true, force: true });
    } else {
        console.log('Cache extracted successfully. Contents:')
        await run('ls', ['-al', cacheSource]);
    }
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheOptions] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheOptions, scratchDir);
    }
}
