import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSizeToBytes,
  parseSearchResults,
  parseMagnetFromDetailPage
} from "../src/searchProviders/x1337.js";

test("parseSizeToBytes: gigabytes / megabytes / kilobytes", () => {
  assert.equal(parseSizeToBytes("1.2 GB"), Math.round(1.2 * 1024 ** 3));
  assert.equal(parseSizeToBytes("856.4 MB"), Math.round(856.4 * 1024 ** 2));
  assert.equal(parseSizeToBytes("12 KB"), 12 * 1024);
  assert.equal(parseSizeToBytes("1,234 MB"), 1234 * 1024 ** 2);
  assert.equal(parseSizeToBytes(""), 0);
  assert.equal(parseSizeToBytes(null), 0);
  assert.equal(parseSizeToBytes("nonsense"), 0);
});

const SEARCH_PAGE = `
  <html><body>
    <table class="table-list">
      <tbody>
        <tr>
          <td class="coll-1 name">
            <a href="/sub/movies/" class="icon"><i></i></a>
            <a href="/torrent/123/Batman-v-Superman-2016-1080p-BluRay/">Batman v Superman 2016 1080p BluRay</a>
          </td>
          <td class="coll-2 seeds">1234</td>
          <td class="coll-3 leeches">56</td>
          <td class="coll-date">Mar. 12th '24</td>
          <td class="coll-4 size mob-uploader">2.5 GB<span class="seeds">1234</span></td>
          <td class="coll-5 uploader"><a href="/user/UploaderX/">UploaderX</a></td>
        </tr>
        <tr>
          <td class="coll-1 name">
            <a href="/sub/movies/" class="icon"><i></i></a>
            <a href="/torrent/456/Batman-v-Superman-Ultimate-720p/">Batman v Superman Ultimate 720p</a>
          </td>
          <td class="coll-2 seeds">0</td>
          <td class="coll-3 leeches">10</td>
          <td class="coll-date">Feb. 1st '24</td>
          <td class="coll-4 size mob-uploader">1.1 GB<span class="seeds">0</span></td>
          <td class="coll-5 uploader"><a href="/user/Y/">Y</a></td>
        </tr>
        <tr>
          <td class="coll-1 name">
            <a href="/sub/movies/" class="icon"><i></i></a>
            <a href="/torrent/789/Some-Other-Movie-2024/">Some Other Movie 2024</a>
          </td>
          <td class="coll-2 seeds">421</td>
          <td class="coll-3 leeches">23</td>
          <td class="coll-date">Jan. 1st '24</td>
          <td class="coll-4 size mob-uploader">856.4 MB<span class="seeds">421</span></td>
          <td class="coll-5 uploader"><a href="/user/Z/">Z</a></td>
        </tr>
      </tbody>
    </table>
  </body></html>
`;

test("parseSearchResults: extracts name, seeds, leeches, size, date, uploader", () => {
  const results = parseSearchResults(SEARCH_PAGE, "1337x.st");
  assert.equal(results.length, 3);

  const r0 = results[0];
  assert.equal(r0.name, "Batman v Superman 2016 1080p BluRay");
  assert.equal(r0.seeds, 1234);
  assert.equal(r0.leeches, 56);
  assert.equal(r0.sizeText, "2.5 GB");
  assert.equal(r0.sizeBytes, Math.round(2.5 * 1024 ** 3));
  assert.equal(r0.date, "Mar. 12th '24");
  assert.equal(r0.uploader, "UploaderX");
  assert.equal(r0.detailPath, "/torrent/123/Batman-v-Superman-2016-1080p-BluRay/");
  assert.equal(r0.detailUrl, "https://1337x.st/torrent/123/Batman-v-Superman-2016-1080p-BluRay/");
  assert.equal(r0.magnet, null);
});

test("parseSearchResults: returns empty array for no rows", () => {
  const results = parseSearchResults("<html><body><p>No torrents found.</p></body></html>");
  assert.deepEqual(results, []);
});

const DETAIL_PAGE = `
  <html><body>
    <div class="torrent-detail-page">
      <ul class="dropdown-menu">
        <li><a href="magnet:?xt=urn:btih:ABCDEF123&dn=Batman.v.Superman.2016&tr=udp%3A%2F%2Ftracker.example%3A6969">Magnet Download</a></li>
        <li><a href="/somewhere-else">Other</a></li>
      </ul>
    </div>
  </body></html>
`;

test("parseMagnetFromDetailPage: returns first magnet anchor", () => {
  const magnet = parseMagnetFromDetailPage(DETAIL_PAGE);
  assert.ok(magnet);
  assert.ok(magnet.startsWith("magnet:"));
  assert.match(magnet, /xt=urn:btih:ABCDEF123/);
});

test("parseMagnetFromDetailPage: returns null when no magnet present", () => {
  const magnet = parseMagnetFromDetailPage("<html><body><a href='/other'>x</a></body></html>");
  assert.equal(magnet, null);
});
