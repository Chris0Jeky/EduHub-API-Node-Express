const test = require('node:test');
const assert = require('node:assert/strict');
const { api, listingCollection } = require('./helpers');

test('#11 list filters reject operator objects and arrays before querying collections', async t => {
    const lessons = listingCollection([]);
    const orders = listingCollection([]);
    const request = await api(t, { lessons, orders });
    for (const [route, fields] of [
        ['lessons', ['topic', 'location']],
        ['orders', ['status', 'paymentStatus']]
    ]) {
        for (const field of fields) {
            for (const query of [
                `${field}[$regex]=%28a%2B%29%2B%24`, `${field}[$ne]=`,
                `${field}[nested][value]=x`, `${field}[]=x`, `${field}=x&${field}=y`
            ]) {
                assert.equal((await request(`/api/${route}?${query}`)).status, 400, `${route}: ${query}`);
            }
        }
    }
    assert.equal(lessons.calls.length, 0);
    assert.equal(orders.calls.length, 0);
});

test('#11 string filters keep exact matches and remain optional', async t => {
    const lessons = listingCollection([
        { topic: 'Math', location: 'London' },
        { topic: 'Math', location: 'Paris' },
        { topic: 'Art', location: 'London' }
    ]);
    const orders = listingCollection([
        { status: 'confirmed', paymentStatus: 'pending' },
        { status: 'confirmed', paymentStatus: 'paid' },
        { status: 'cancelled', paymentStatus: 'pending' }
    ]);
    const request = await api(t, { lessons, orders });
    for (const [path, total] of [
        ['lessons', 3], ['lessons?topic=&location=', 3],
        ['lessons?topic=Math&location=London', 1], ['lessons?topic=%24ne', 0],
        ['orders', 3], ['orders?status=&paymentStatus=', 3],
        ['orders?status=confirmed&paymentStatus=pending', 1], ['orders?status=%24ne', 0]
    ]) {
        const response = await request(`/api/${path}`);
        assert.equal(response.status, 200, path);
        assert.equal(response.body.data.pagination.total, total, path);
    }
});

test('#11 search rejects NUL bytes before querying collections', async t => {
    const lessons = listingCollection([]);
    const request = await api(t, { lessons });
    for (const query of ['search=%00', 'search=Math%00', 'search=%00Math', 'search=Ma%00th']) {
        assert.equal((await request(`/api/lessons?${query}`)).status, 400, query);
    }
    assert.equal(lessons.calls.length, 0);
});
