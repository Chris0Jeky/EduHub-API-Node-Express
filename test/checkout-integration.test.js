const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { MongoClient, ObjectId } = require('mongodb');

const uri = process.env.EDUHUB_TEST_MONGODB_URI;
const suite = uri ? test : test.skip;

suite('real MongoDB checkout transactions and retry contract', async t => {
    assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/, 'Integration fixture must use loopback MongoDB');
    const client = await MongoClient.connect(uri);
    const db = client.db(`eduhub_test_${process.pid}_${Date.now()}`);
    const net = require('node:net');
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const childUri = new URL(uri);
    childUri.pathname = `/${db.databaseName}`;
    const child = spawn(process.execPath, ['index.js'], { cwd: require('node:path').join(__dirname, '..'),
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: childUri.toString() },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { output += value; });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGINT'); await once(child, 'exit'); }
        await db.dropDatabase(); await client.close();
    });
    await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
            if (output.includes('Server running')) { clearInterval(timer); resolve(); }
            else if (child.exitCode !== null) { clearInterval(timer); reject(new Error(output)); }
        }, 20);
        setTimeout(() => { clearInterval(timer); reject(new Error(`Startup timed out: ${output}`)); }, 10000).unref();
    });
    const lessons = db.collection('lessons'), orders = db.collection('orders');
    const seed = async (spaces = 3, legacy = false) => {
        await lessons.deleteMany({}); await orders.deleteMany({});
        const lesson = { _id: new ObjectId(), topic: 'Test Math', location: 'London', price: 10, [legacy ? 'space' : 'spaces']: spaces };
        await lessons.insertOne(lesson); return lesson;
    };
    const payload = lesson => ({ name: 'Test Student', phone: '07123456789', lessons: [{ lessonId: lesson._id.toString(), quantity: 1 }] });
    const post = async (body, key) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/orders`, { method: 'POST', headers: {
            'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {})
        }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    };
    await t.test('lost successful response replay returns original order without another decrement', async () => {
        const lesson = await seed(); const body = payload(lesson), key = 'test-lost-response-0001';
        const discarded = await post(body, key); // Request committed; caller loses/discards its response.
        const replay = await post(body, key);
        assert.equal(discarded.status, 201); assert.equal(replay.status, 201);
        assert.deepEqual(replay.body.data, discarded.body.data);
        assert.equal('checkoutKey' in replay.body.data.order, false);
        assert.equal(await orders.countDocuments(), 1);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 2);
    });
    await t.test('concurrent identical keys have one authoritative order and stable replay', async () => {
        const lesson = await seed(); const body = payload(lesson), key = 'test-concurrent-key-0001';
        const responses = await Promise.all(Array.from({ length: 5 }, () => post(body, key)));
        assert.ok(responses.every(r => r.status === 201), JSON.stringify(responses));
        assert.equal(new Set(responses.map(r => r.body.data.order._id)).size, 1);
        assert.equal(await orders.countDocuments(), 1);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 2);
    });
    await t.test('same key with changed payload rejects without consuming stock', async () => {
        const lesson = await seed(); const body = payload(lesson), key = 'test-payload-conflict-01';
        await post(body, key);
        const response = await post({ ...body, name: 'Different Student' }, key);
        assert.equal(response.status, 409); assert.equal(await orders.countDocuments(), 1);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 2);
    });
    await t.test('concurrent key reuse with different lessons rolls back the losing transaction', async () => {
        const lesson = await seed(2); const other = { ...lesson, _id: new ObjectId() };
        await lessons.insertOne(other);
        const responses = await Promise.all([post(payload(lesson), 'test-cross-lesson-conflict'), post(payload(other), 'test-cross-lesson-conflict')]);
        assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
        assert.equal(await orders.countDocuments(), 1);
        const stocks = await lessons.find().sort({ spaces: 1 }).toArray();
        assert.deepEqual(stocks.map(row => row.spaces), [1, 2]);
    });
    await t.test('malformed checkout key is rejected before any stock or order changes', async () => {
        const lesson = await seed(2);
        assert.equal((await post(payload(lesson), 'short')).status, 400);
        assert.equal(await orders.countDocuments(), 0);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 2);
    });
    await t.test('two different checkout keys competing for last seat never go negative', async () => {
        const lesson = await seed(1);
        const responses = await Promise.all([post(payload(lesson), 'test-client-a-last-seat'), post(payload(lesson), 'test-client-b-last-seat')]);
        assert.deepEqual(responses.map(r => r.status).sort(), [201, 400]);
        assert.equal(await orders.countDocuments(), 1);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 0);
    });
    await t.test('later line failure rolls back earlier decrement and same key can retry corrected availability', async () => {
        const lesson = await seed(2); const second = { ...lesson, _id: new ObjectId(), spaces: 0 };
        await lessons.insertOne(second);
        const body = payload(lesson); body.lessons.push({ lessonId: second._id.toString(), quantity: 1 });
        const key = 'test-rollback-retry-001';
        assert.equal((await post(body, key)).status, 400);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 2);
        assert.equal(await orders.countDocuments(), 0);
        await lessons.updateOne({ _id: second._id }, { $set: { spaces: 1 } });
        assert.equal((await post(body, key)).status, 201);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 1);
        assert.equal((await lessons.findOne({ _id: second._id })).spaces, 0);
        assert.equal(await orders.countDocuments(), 1);
    });
    await t.test('order insert failure rolls back stock and permits the unchanged keyed retry', async () => {
        const lesson = await seed(2), body = payload(lesson), key = 'test-insert-failure-retry';
        await db.command({ collMod: 'orders', validator: { unavailableTestField: { $exists: true } } });
        try {
            assert.equal((await post(body, key)).status, 500);
            assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 2);
            assert.equal(await orders.countDocuments(), 0);
        } finally {
            await db.command({ collMod: 'orders', validator: {} });
        }
        assert.equal((await post(body, key)).status, 201);
        assert.equal((await lessons.findOne({ _id: lesson._id })).spaces, 1);
        assert.equal(await orders.countDocuments(), 1);
    });
    await t.test('legacy space documents and clients without keys remain supported', async () => {
        const lesson = await seed(2, true);
        assert.equal((await post(payload(lesson))).status, 201);
        assert.equal((await post(payload(lesson))).status, 201);
        assert.equal((await lessons.findOne({ _id: lesson._id })).space, 0);
        assert.equal(await orders.countDocuments(), 2);
    });
    await t.test('tied lesson sort values reach every record exactly once across server pages', async () => {
        await lessons.deleteMany({});
        const rows = Array.from({ length: 250 }, () => ({ _id: new ObjectId(), topic: 'Same Math', location: 'Same Room', price: 10, spaces: 2 }));
        await lessons.insertMany(rows);
        const expected = rows.map(row => row._id.toString()).sort();
        for (const sortBy of ['topic', 'location', 'price', 'spaces']) {
            for (const order of ['asc', 'desc']) {
                const ids = [];
                for (const page of [1, 2, 3]) {
                    const response = await fetch(`http://127.0.0.1:${port}/api/lessons?sortBy=${sortBy}&order=${order}&limit=100&page=${page}`);
                    assert.equal(response.status, 200);
                    const result = await response.json();
                    ids.push(...result.data.lessons.map(row => row._id));
                }
                assert.equal(ids.length, 250);
                assert.equal(new Set(ids).size, 250, `${sortBy} ${order} must not drop records with equal sort values`);
                assert.deepEqual(ids, expected, 'Equal values have a stable ascending ObjectId tie breaker');
            }
        }
    });
    await t.test('startup enforces unique sparse checkout-key index', async () => {
        const indexes = await orders.indexes();
        assert.ok(indexes.some(index => index.key.checkoutKey === 1 && index.unique === true && index.sparse === true));
    });
});
