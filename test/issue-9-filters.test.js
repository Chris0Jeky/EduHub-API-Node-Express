const test = require('node:test');
const assert = require('node:assert/strict');
const { api, listingCollection } = require('./helpers');

test('#9 search and availability compose with legacy fields, other filters, sorting and pagination', async t => {
    const lessons = listingCollection([
        { topic: 'Math', location: 'London', price: 10, spaces: 0 },
        { topic: 'Math', location: 'London', price: 20, space: 3 },
        { topic: 'Math', location: 'London', price: 30, spaces: 2 },
        { topic: 'Math', location: 'Paris', price: 25, spaces: 4 },
        { topic: 'Math', location: 'London', price: 20 },
        { topic: 'Art', location: 'London', price: 15, spaces: 2 }
    ]);
    const request = await api(t, { lessons });
    for (const [query, prices, total] of [
        ['search=Math&minSpaces=1', [20, 30, 25], 3],
        ['minSpaces=1', [15, 20, 30, 25], 4],
        ['search=Math', [10, 20, 30, 25, 20], 5],
        ['search=Math&minSpaces=0', [10, 20, 30, 25], 4],
        ['search=Math&minSpaces=1&topic=Math&location=London&minPrice=15&maxPrice=30&sortBy=price&order=desc&page=2&limit=1', [20], 2]
    ]) {
        const response = await request(`/api/lessons?${query}`);
        assert.equal(response.status, 200, query);
        assert.deepEqual(response.body.data.lessons.map(lesson => lesson.price), prices, query);
        assert.equal(response.body.data.pagination.total, total);
        if (query.includes('minSpaces=1')) {
            assert.ok(response.body.data.lessons.every(lesson => lesson.available && lesson.spaces >= 1));
        }
    }
});

test('#9 invalid minSpaces is rejected before querying collections', async t => {
    const lessons = listingCollection([]);
    const request = await api(t, { lessons });
    for (const query of ['minSpaces=-1', 'minSpaces=1.5', 'minSpaces[]=1', 'minSpaces[x]=1', 'minSpaces=9007199254740993']) {
        assert.equal((await request(`/api/lessons?${query}`)).status, 400, query);
    }
    assert.equal(lessons.calls.length, 0);
});
