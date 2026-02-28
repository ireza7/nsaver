"""Unit tests for nsaver main module."""

import pytest
from main import extract_gallery_codes, extract_gallery_titles, get_last_page


# ---------------------------------------------------------------------------
# Sample HTML fragments
# ---------------------------------------------------------------------------
SAMPLE_FAVORITES_HTML = """
<html>
<body>
<div class="container">
  <div class="gallery" data-tags="123">
    <a href="/g/632562/" class="cover">
      <img src="//t.nhentai.net/galleries/123/cover.jpg" />
    </a>
    <div class="caption">Test Gallery One</div>
  </div>
  <div class="gallery" data-tags="456">
    <a href="/g/627977/" class="cover">
      <img src="//t.nhentai.net/galleries/456/cover.jpg" />
    </a>
    <div class="caption">Test Gallery Two</div>
  </div>
  <div class="gallery" data-tags="789">
    <a href="/g/626430/" class="cover">
      <img src="//t.nhentai.net/galleries/789/cover.jpg" />
    </a>
    <div class="caption">Test Gallery Three</div>
  </div>
</div>
<section class="pagination">
  <a href="?page=1" class="page">1</a>
  <a href="?page=2" class="page">2</a>
  <a href="?page=5" class="last">&raquo;</a>
</section>
</body>
</html>
"""

SAMPLE_SINGLE_PAGE_HTML = """
<html>
<body>
<div class="container">
  <div class="gallery">
    <a href="/g/111111/" class="cover">
      <img src="//t.nhentai.net/galleries/111/cover.jpg" />
    </a>
    <div class="caption">Only One</div>
  </div>
</div>
</body>
</html>
"""

SAMPLE_EMPTY_HTML = """
<html><body><div class="container"></div></body></html>
"""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestExtractGalleryCodes:
    def test_extracts_multiple_codes(self):
        codes = extract_gallery_codes(SAMPLE_FAVORITES_HTML)
        assert codes == ["632562", "627977", "626430"]

    def test_extracts_single_code(self):
        codes = extract_gallery_codes(SAMPLE_SINGLE_PAGE_HTML)
        assert codes == ["111111"]

    def test_empty_page_returns_empty_list(self):
        codes = extract_gallery_codes(SAMPLE_EMPTY_HTML)
        assert codes == []


class TestExtractGalleryTitles:
    def test_extracts_codes_and_titles(self):
        result = extract_gallery_titles(SAMPLE_FAVORITES_HTML)
        assert result == {
            "632562": "Test Gallery One",
            "627977": "Test Gallery Two",
            "626430": "Test Gallery Three",
        }

    def test_single_gallery(self):
        result = extract_gallery_titles(SAMPLE_SINGLE_PAGE_HTML)
        assert result == {"111111": "Only One"}

    def test_empty_page(self):
        result = extract_gallery_titles(SAMPLE_EMPTY_HTML)
        assert result == {}


class TestGetLastPage:
    def test_detects_last_page(self):
        last = get_last_page(SAMPLE_FAVORITES_HTML)
        assert last == 5

    def test_single_page(self):
        last = get_last_page(SAMPLE_SINGLE_PAGE_HTML)
        assert last == 1

    def test_empty_page(self):
        last = get_last_page(SAMPLE_EMPTY_HTML)
        assert last == 1
