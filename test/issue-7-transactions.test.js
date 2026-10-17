const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { api } = require('./helpers');

test('#7 withTransaction preserves validation errors, ends sessions and permits successful orders', async t => {
    // No connect(): collection calls stay in memory; the driver owns the real session lifecycle.
    const client = new MongoClient('mongodb://127.0.0.1:1');
    t.after(() => client.close());
    const startSession = client.startSession.bind(client);
    const sessions = [];
    t.mock.method(client, 'startSession', () => {
        const session = startSession();
        t.mock.method(session, 'abortTransaction');
        sessions.push(session);
        return session;
    });
    const document = { _id: new ObjectId(), topic: 'Math', location: 'London', price: 10, spaces: 1 };
    const orders = [];
    let databaseFailure = false;
    const lessons = {
        async findOne(filter) {
            if (databaseFailure) throw new Error('private database detail');
            return document._id.equals(filter._id) ? document : null;
        },
        async updateOne(filter, update) {
            assert.equal(filter.spaces.$gte, 1);
            document.spaces += update.$inc.spaces;
            return { modifiedCount: 1 };
        }
    };
    const request = await api(t, {
        lessons,
        orders: {
            async insertOne(order) {
                orders.push(order);
                return { insertedId: new ObjectId() };
            }
        }
    }, client);
    const body = (lessonId, quantity) => ({ name: 'Test Student', phone: '123456789', lessons: [{ lessonId, quantity }] });

    for (let attempt = 0; attempt < 2; attempt++) {
        for (const [lessonId, quantity, status] of [
            [new ObjectId().toString(), 1, 404], [document._id.toString(), 2, 400]
        ]) {
            const response = await request('/api/orders', 'POST', body(lessonId, quantity));
            assert.equal(response.status, status);
            assert.equal(orders.length, 0);
            assert.equal(document.spaces, 1);
            assert.equal(sessions.at(-1).abortTransaction.mock.callCount(), 1);
            assert.equal(sessions.at(-1).hasEnded, true);
        }
    }
    const success = await request('/api/orders', 'POST', body(document._id.toString(), 1));
    assert.equal(success.status, 201);
    assert.equal(success.body.data.order.totalAmount, 10);
    assert.equal(orders.length, 1);
    assert.equal(document.spaces, 0);
    assert.equal(sessions.at(-1).abortTransaction.mock.callCount(), 0);
    assert.equal(sessions.at(-1).hasEnded, true);

    databaseFailure = true;
    const failure = await request('/api/orders', 'POST', body(document._id.toString(), 1));
    assert.equal(failure.status, 500);
    assert.equal(failure.body.message, 'Failed to create order');
    assert.equal(sessions.at(-1).hasEnded, true);
});
