const test = require('node:test');
const assert = require('node:assert/strict');
const { api, listingCollection } = require('./helpers');

test('#8 both list routes reject unsafe pagination before querying collections', async t => {
    const lessons = listingCollection([]);
    const orders = listingCollection([]);
    const request = await api(t, { lessons, orders });
    for (const route of ['lessons', 'orders']) {
        for (const query of [
            'limit=0', 'limit=1000000', 'limit=-1', 'limit=1.5', 'limit=1e2', 'limit=20x',
            'limit=', 'limit=01', 'limit[]=20', 'limit=20&limit=20', 'limit[x]=20',
            'page=0', 'page=-1', 'page=1.5', 'page=2x', 'page=', 'page[]=1', 'page[x]=1',
            'page=9007199254740993', 'page=102&limit=100',
            'page=10002&limit=1'
        ]) {
            const response = await request(`/api/${route}?${query}`);
            assert.equal(response.status, 400, `${route}: ${query}`);
        }
    }
    assert.equal(lessons.calls.length, 0);
    assert.equal(orders.calls.length, 0);
});

test('#8 both list routes cap retrieval and keep finite pagination and query deadlines', async t => {
    const documents = Array.from({ length: 101 }, (_, index) => ({ topic: `Lesson ${String(index).padStart(3, '0')}`, createdAt: index }));
    const lessons = listingCollection(documents);
    const orders = listingCollection(documents);
    const request = await api(t, { lessons, orders });
    for (const route of ['lessons', 'orders']) {
        for (const [query, count, page, limit, pages] of [
            ['', 20, 1, 20, 6], ['page=2&limit=20', 20, 2, 20, 6],
            ['page=6&limit=20', 1, 6, 20, 6], ['limit=100', 100, 1, 100, 2],
            ['page=101&limit=100', 0, 101, 100, 2], ['page=10001&limit=1', 0, 10001, 1, 101]
        ]) {
            const response = await request(`/api/${route}?${query}`);
            assert.equal(response.status, 200, `${route}: ${query}`);
            assert.equal(response.body.data[route].length, count);
            assert.deepEqual(response.body.data.pagination, { total: 101, page, limit, pages });
        }
        const collection = route === 'lessons' ? lessons : orders;
        for (const call of collection.calls) {
            assert.ok(call.options.maxTimeMS > 0 && call.options.maxTimeMS <= 1000);
            if (call.operation === 'find') {
                assert.ok(call.limit >= 1 && call.limit <= 100);
                assert.ok(call.skip >= 0 && call.skip <= 10000);
            }
        }
    }
});
