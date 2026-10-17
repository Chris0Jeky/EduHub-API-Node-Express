const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { errorHandler } = require('../middleware/errorHandler');

async function api(t, collections, client) {
    const app = express();
    app.use(express.json());
    app.locals.db = {
        collection(name) {
            assert.ok(collections[name], `Unexpected collection: ${name}`);
            return collections[name];
        }
    };
    app.locals.client = client;
    app.use('/api/lessons', require('../routes/lessonRoutes'));
    app.use('/api/orders', require('../routes/orderRoutes'));
    app.use(errorHandler);
    t.mock.method(console, 'error', () => {});

    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    t.after(() => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())));

    return (path, method = 'GET', body) => new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1', port: server.address().port, path, method,
            headers: { 'Content-Type': 'application/json' }
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (err) {
                    reject(err);
                }
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

function matches(document, filter) {
    return Object.entries(filter).every(([field, value]) => {
        if (field === '$or') return value.some(clause => matches(document, clause));
        if (field === '$and') return value.every(clause => matches(document, clause));
        if (value instanceof RegExp) return typeof document[field] === 'string' && value.test(document[field]);
        if (value && typeof value === 'object') {
            return Object.entries(value).every(([operator, bound]) => {
                if (operator === '$gte') return document[field] >= bound;
                if (operator === '$lte') return document[field] <= bound;
                throw new Error(`Unsupported operator: ${operator}`);
            });
        }
        return document[field] === value;
    });
}

function listingCollection(documents) {
    const calls = [];
    return {
        calls,
        async countDocuments(filter, options) {
            calls.push({ operation: 'count', filter, options });
            return documents.filter(document => matches(document, filter)).length;
        },
        find(filter, options) {
            const call = { operation: 'find', filter, options, skip: 0, limit: 0 };
            calls.push(call);
            return {
                sort(sort) { call.sort = sort; return this; },
                skip(skip) { call.skip = skip; return this; },
                limit(limit) { call.limit = limit; return this; },
                async toArray() {
                    const [field, direction] = Object.entries(call.sort)[0];
                    const results = documents.filter(document => matches(document, filter))
                        .sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * direction)
                        .slice(call.skip);
                    return call.limit === 0 ? results : results.slice(0, call.limit);
                }
            };
        }
    };
}

module.exports = { api, listingCollection };
