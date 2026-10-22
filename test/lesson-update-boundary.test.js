const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { api } = require('./helpers');

test('lesson updates reject unsupported and dotted fields before accessing MongoDB', async t => {
    const writes = [];
    const id = new ObjectId();
    const request = await api(t, { lessons: {
        async findOneAndUpdate(filter, update) {
            writes.push(update);
            return { _id: filter._id, ...update.$set };
        }
    } });
    for (const body of [
        { _id: new ObjectId().toString() },
        { adminOnly: true },
        { 'topic.hidden': 'value' },
        { '$where': 'untrusted' },
        { topic: 'Math', internalNotes: 'untrusted' },
        [{ topic: 'Math' }]
    ]) {
        const response = await request(`/api/lessons/${id}`, 'PUT', body);
        assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal(writes.length, 0);
});

test('lesson updates preserve supported fields and synchronize either stock alias', async t => {
    const id = new ObjectId();
    const writes = [];
    const request = await api(t, { lessons: {
        async findOneAndUpdate(filter, update) {
            writes.push(update.$set);
            return { _id: filter._id, ...update.$set };
        }
    } });
    for (const alias of ['space', 'spaces']) {
        const body = { topic: 'Math', location: 'London', price: 12.5,
            description: 'After school', image: 'math.gif', [alias]: 3 };
        const response = await request(`/api/lessons/${id}`, 'PUT', body);
        assert.equal(response.status, 200);
        assert.deepEqual(writes.at(-1), { ...body, space: 3, spaces: 3 });
    }
});
