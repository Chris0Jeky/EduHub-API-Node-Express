const test = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { api } = require('./helpers');

test('#6 lesson updates return the MongoDB v6 document and missing IDs return 404', async t => {
    let document = { _id: new ObjectId(), topic: 'Before', price: 10, spaces: 5 };
    const lessons = {
        async findOneAndUpdate(filter, update, options) {
            assert.equal(options.returnDocument, 'after');
            assert.notEqual(options.includeResultMetadata, true);
            if (!document._id.equals(filter._id)) return null;
            document = { ...document, ...update.$set };
            return document;
        }
    };
    const request = await api(t, { lessons });
    for (const value of [undefined, { nested: 'Keep this property' }]) {
        document.value = value;
        const response = await request(`/api/lessons/${document._id}`, 'PUT', { topic: 'After' });
        assert.equal(document.topic, 'After');
        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data.lesson, JSON.parse(JSON.stringify(document)));
    }
    const missing = await request(`/api/lessons/${new ObjectId()}`, 'PUT', { topic: 'Missing' });
    assert.equal(missing.status, 404);
    assert.equal(document.topic, 'After');
});
