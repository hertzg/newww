var elasticsearch = require('elasticsearch'),
    Hapi = require('hapi'),
    log = require('bole')('registry-search'),
    merge = require('lodash').merge
    metrics = require('newww-metrics')();

module.exports = function (options) {
  var client = new elasticsearch.Client({
    host: options.url
  });

  return function (request, reply) {

    if (!request.query || !request.query.q) {
      return reply.redirect('/');
    }

    var addMetric = metrics.addMetric,
        addLatencyMetric = metrics.addPageLatencyMetric,
        showError = request.server.methods.errors.showError(reply),
        timer = { start: Date.now() };

    var page = +request.query.page || 1;
    var perPage  = parseInt(options.perPage);
    var searchQuery = {
      fields : ['name', 'keywords','description','author','version', 'stars', 'dlScore', 'dlDay', 'dlWeek'],
      body: {
        from: (page - 1) * perPage,
        size : perPage,
        "query" : {
          "dis_max": {
            "tie_breaker": 0.7,
            "boost": 1.2,
            "queries": [
              {
                "function_score": {
                  "query": {
                    "match": {
                      "name.untouched": request.query.q
                      /*"name.untouched":{
                        "query": request.query.q,
                        "operator": "and"
                      }*/
                    }
                  },
                  "boost_factor": 100
                }
              },
              {
                "bool": {
                  "should": [
                  {"match_phrase": {"name": request.query.q} },
                  {"match_phrase": {"keywords": request.query.q} },
                  {"match_phrase": {"description": request.query.q} },
                  {"match_phrase": {"readme": request.query.q} }
                  ],
                  "minimum_should_match": 1,
                  "boost": 50
                }
              },
              {
                "function_score": {
                  "query": {
                    "multi_match": {
                      "query": request.query.q,
                      "fields": ["name^4", "keywords", "description", "readme"]
                    }
                  },
                  "functions": [
                    {
                      "script_score": {
                        "script": "(doc['dlScore'].isEmpty() ? 0 : doc['dlScore'].value)"
                      }
                    },
                    {
                      "script_score": {
                        "script": "doc['stars'].isEmpty() ? 0 : doc['stars'].value"
                      }
                    }
                  ],
                  "score_mode": "sum",
                  "boost_mode": "multiply"
                }
              }
            ]
          }
        }
      }
    };

    client.search(searchQuery, function (error, response) {
      timer.end = Date.now();
      addMetric({
        name: 'latency',
        value: timer.end - timer.start,
        type: 'elasticsearch',
        query: request.query.q
      });

      var opts = {
        user: request.auth.credentials,
        
        namespace: 'registry-search'
      };

      if (error) {
        return showError(error, 500, 'elasticsearch failed searching ' + request.query.q, opts);
      }

      timer.end = Date.now();
      addLatencyMetric(timer, 'search');

      addMetric({ name: 'search', search: request.query.q });

      merge(opts, {
        title: 'results for ',
        page: page,
        q: request.query.q,
        results: response.hits.hits,
        totalResults: response.hits.total,
        singleResult: response.hits.total === 1,
        prevPage: page > 0 ? page - 1 : null,
        nextPage: response.hits.total >= (perPage * page) ? page + 1 : null
      })

      opts.paginate = opts.prevPage || opts.nextPage

      // Return raw context object if `json` query param is present
      if (String(process.env.NODE_ENV).match(/dev|staging/) &&  'json' in request.query) {
        return reply(opts);
      }

      reply.view('registry/search', opts);

    });
  }
}
