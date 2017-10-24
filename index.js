const got = require('got');
const url = require('url');
const path = require('path');
const cookie = require('cookie');
const table = require('text-table');

require('dotenv-safe').load({
    path: path.resolve(__dirname, '.env'),
    sample: path.resolve(__dirname, '.env.example')
});

const argv = require('yargs')
    .option('version', {
        alias: 'v',
        describe: 'Hub version to ',
        type: 'string'
    })
    .option('type', {
        alias: 't',
        describe: 'Don\'t make a rest-backend build, useful for unmounting / remounting containers',
        type: 'boolean',
        default: false
    })
    .option('name', {
        alias: 'n',
        describe: 'Prune docker images. We remove the currently mounted docker containers before pruning.',
        type: 'boolean',
        default: false
    })
    .help()
    .argv;

const credentials = {
    j_username: process.env.HUB_USERNAME,
    j_password: process.env.HUB_PASSWORD
};

const authenticate = async (server) => {
    const { origin } = server;
    const authUrl = url.resolve(origin, '/j_spring_security_check');

    let authResponse;
    try {
        authResponse = await got.post(authUrl, {
            form: true,
            body: credentials,
            rejectUnauthorized: false
        });
    } catch (err) {
        return server;
    }

    const { headers } = authResponse;
    const [sessionCookie] = headers['set-cookie'] || [];
    const sessionId = sessionCookie ? cookie.parse(sessionCookie).JSESSIONID : false;

    return {
        ...server,
        sessionId,
        isAlive: authResponse.statusCode === 204,
    };
};

const getServerVersion = async (server) => {
    const { origin, sessionId } = server;
    const manifestUrl = url.resolve(origin, '/debug?manifest');

    let response;
    try {
        response = await got(manifestUrl, {
            rejectUnauthorized: false,
            headers: {
                cookie: cookie.serialize('JSESSIONID', sessionId)
            },
            timeout: 3000
        });
    } catch (err) {
        return {};
    }

    const manifest = response.body;
    const version = manifest
        .split('\n')
        .find(line => line.includes('Product-version'))
        .split(': ')[1];

    return {
        [origin]: version && version.trim()
    };
};


(async () => {
    const chalk = require('chalk');
    const semverCompare = require('semver-compare');
    const servers = await Promise.all(require('./servers').map(authenticate));
    const liveServers = servers.filter(({ isAlive }) => isAlive);
    const versionMap = Object.assign(
        {},
        ...await Promise.all(liveServers.map(getServerVersion))
    );
    const t = table([
        ['Origin', 'Type', 'Version', 'Status'],
        ...servers
            .sort((serverA, serverB) => {
                const verA = versionMap[serverA.origin];
                const verB = versionMap[serverB.origin];

                if (!verA && !verB) {
                    return 0;
                } else if (!verA) {
                    return 1;
                } else if (!verB) {
                    return -1;
                }

                return semverCompare(verA.split('-')[0], verB.split('-')[0]);
            })
            .map(({ type, origin, isAlive }) => {
                const color = isAlive ? chalk.bgBlack.greenBright : chalk.bgBlack.redBright;
                const version = versionMap[origin] || 'N/A';
                const status = isAlive ? 'UP' : 'DOWN';
                return [origin, type, version, color(status)];
            })
    ]);

    console.log(t);
})();
