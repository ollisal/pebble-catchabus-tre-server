var express = require('express');
var app = express();

var request = require('superagent');
var cheerio = require('cheerio');

var async = require('async');
var _ = require('lodash');

app.get('/', function (req, res) {
  var lat = req.query.lat, lon = req.query.lon;

  if (!lat || !lon) {
    res.status(400).json({ message: 'lat/long params are required' });
    return;
  }

  console.log('Finding closest stops at', lat, lon);

  async.waterfall([
    function (cb) {
      request
        .get('http://api.publictransport.tampere.fi/prod/')
        .query({
          request: 'stops_area',
          user: 'ollisa-pebble',
          pass: 'NcR5rZJR',
          center_coordinate: lon + ',' + lat,
          diameter: req.query.diameter || 500,
          epsg_in: 'wgs84',
          epsg_out: 'wgs84'
        })
        .end(function (err, res) {
          cb(err, res.body);
        });
    },
    function (stops, allStopsScraped) {
      console.log('Got', stops.length, 'stops');

      async.map(stops,
        function (stop, stopScraped) {
          async.waterfall([
            function (cb) {
              request
                .get('http://lissu.tampere.fi/monitor.php')
                .query({stop: stop.code})
                .buffer(true)
                .end(function (err, res) {
                  cb(err, res.text);
                });
            },
            function (html, cb) {
              console.log('Got', html.length, 'bytes of HTML for stop', stop.name);

              var $ = cheerio.load(html);

              var hhmm = $('.table1 td:nth-child(2)').text().match(/(\d+):(\d+)/);
              var currTime = new Date();
              currTime.setHours(hhmm[1], hhmm[2]);

              var buses = $('.table2 tr[style]')
                .map(function (i, el) {
                  function normalizeEta(eta) {
                    if (/^\d+ min/.test(eta)) {
                      return parseInt(eta, 10);
                    } else if (/\d+:\d+/.test(eta)) {
                      var hhmm = eta.match(/(\d+):(\d+)/);
                      var etaTime = new Date();
                      etaTime.setHours(hhmm[1], hhmm[2]);

                      if (etaTime.getTime() < currTime.getTime()) {
                        etaTime.setDate(etaTime.getDate() + 1);
                      }

                      return Math.round((etaTime.getTime() - currTime.getTime()) / 60000);
                    } else {
                      return -1;
                    }
                  }

                  return {
                    id: parseInt($('td:nth-child(1)', el).text(), 10),
                    dest: $('td:nth-child(3)', el).text(),
                    min1: normalizeEta($('td:nth-child(4)', el).text()),
                    min2: normalizeEta($('td:nth-child(5)', el).text())
                  };
                })
                .get();

              console.log('Got', buses.length, 'buses for stop', stop.name);

              cb(null, {
                id: stop.code,
                dist: stop.dist,
                name: stop.name,
                buses: buses
              });
            }
          ], stopScraped);
        }, allStopsScraped);
    }
  ], function (err, stopInfo) {
    if (err) {
      res.status(500).json({error: err});
    } else {
      res.status(200).json(_.sortBy(stopInfo, 'dist'));
    }
  });
});

var server = app.listen(16000, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log('Server listening at http://%s:%s', host, port);
});
