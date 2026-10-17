const test = require('node:test');
const assert = require('node:assert/strict');
const { api, listingCollection } = require('./helpers');

test('#5 search matches case-insensitive literal text, including malformed regex and Unicode', async t => {
    const lessons = listingCollection([
        { topic: 'a.b' }, { topic: 'acb' }, { topic: '[' },
        { topic: 'Café 😀' }, { location: 'LONDON' }, { description: 'Learn C++' },
        { topic: '.*+?^${}()|[]\\' }
    ]);
    const request = await api(t, { lessons });
    for (const [search, expected] of [
        ['a.b', [0]], ['[', [6, 2]], ['CAFÉ 😀', [3]], ['london', [4]],
        ['C++', [5]], ['.*+?^${}()|[]\\', [6]]
    ]) {
        const response = await request(`/api/lessons?search=${encodeURIComponent(search)}`);
        assert.equal(response.status, 200, search);
        assert.equal(response.body.data.lessons.length, expected.length, search);
        for (const call of lessons.calls.slice(-2)) {
            assert.ok(call.options.maxTimeMS > 0 && call.options.maxTimeMS <= 1000);
        }
        const field = search === 'london' ? 'location' : search === 'C++' ? 'description' : 'topic';
        const values = ['a.b', 'acb', '[', 'Café 😀', 'LONDON', 'Learn C++', '.*+?^${}()|[]\\'];
        assert.deepEqual(response.body.data.lessons.map(lesson => lesson[field]), expected.map(index => values[index]));
    }
});

test('#5 search rejects oversized and structured inputs before any database call', async t => {
    const lessons = listingCollection([{ topic: 'x'.repeat(200) }]);
    const request = await api(t, { lessons });
    for (const query of [
        `search=${'x'.repeat(201)}`, `search=${'%20'.repeat(201)}`,
        'search[]=Math', 'search[x]=Math'
    ]) {
        assert.equal((await request(`/api/lessons?${query}`)).status, 400, query);
    }
    assert.equal(lessons.calls.length, 0);
    const response = await request(`/api/lessons?search=${'x'.repeat(200)}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.lessons.length, 1);
});

test('#5 adversarial regex is escaped before a long near-match is evaluated', { timeout: 2000 }, async t => {
    const lessons = listingCollection([
        { topic: 'a'.repeat(50000) + '!' }, { topic: '^(a+)+$' }
    ]);
    const count = lessons.countDocuments.bind(lessons);
    lessons.countDocuments = async (filter, options) => {
        // Check before evaluating the fixture so the unfixed test cannot backtrack indefinitely.
        assert.equal(filter.$or[0].topic.source, '\\^\\(a\\+\\)\\+\\$');
        return count(filter, options);
    };
    const request = await api(t, { lessons });
    const response = await request(`/api/lessons?search=${encodeURIComponent('^(a+)+$')}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data.lessons.map(lesson => lesson.topic), ['^(a+)+$']);
});
