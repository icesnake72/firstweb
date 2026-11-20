// 뉴스 페이지: /api/news 에서 기사를 받아 카드로 그린다
(function () {
  var TOPICS = ["ai", "dev", "tech", "economy", "world"];
  var SKELETON_COUNT = 6;

  var grid = document.getElementById("news-grid");
  var status = document.getElementById("news-status");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".news-tab"));
  var controller = null;

  var relativeTime = "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat("ko", { numeric: "auto" }) : null;

  function formatTime(iso) {
    var time = iso ? new Date(iso).getTime() : NaN;
    if (isNaN(time)) return "";
    var minutes = Math.round((time - Date.now()) / 60000);
    if (!relativeTime) return new Date(time).toLocaleDateString("ko-KR");
    if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
    var hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
    var days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return relativeTime.format(days, "day");
    return new Date(time).toLocaleDateString("ko-KR");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function placeholder() {
    var box = el("div", "news-thumb news-thumb--empty");
    box.setAttribute("aria-hidden", "true");
    box.appendChild(el("i", "fa-regular fa-newspaper"));
    return box;
  }

  function thumbnail(article) {
    if (!article.image) return placeholder();
    var box = el("div", "news-thumb");
    var img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", function () {
      box.replaceWith(placeholder());
    });
    img.src = article.image;
    box.appendChild(img);
    return box;
  }

  function card(article) {
    var item = el("li", "news-item");
    var link = el("a", "news-card");
    link.href = article.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    var body = el("div", "news-body");
    var meta = el("p", "news-meta");
    if (article.source) meta.appendChild(el("span", "news-source", article.source));
    var time = formatTime(article.publishedAt);
    if (time) {
      var timeEl = el("time", "", time);
      timeEl.dateTime = article.publishedAt;
      meta.appendChild(timeEl);
    }
    body.appendChild(meta);
    body.appendChild(el("h2", "news-title", article.title));
    if (article.description) body.appendChild(el("p", "news-desc", article.description));

    link.appendChild(thumbnail(article));
    link.appendChild(body);
    item.appendChild(link);
    return item;
  }

  function showSkeleton() {
    grid.replaceChildren();
    for (var i = 0; i < SKELETON_COUNT; i++) {
      var item = el("li", "news-item");
      var box = el("div", "news-card news-card--skeleton");
      box.setAttribute("aria-hidden", "true");
      box.appendChild(el("div", "news-thumb"));
      var body = el("div", "news-body");
      body.appendChild(el("span", "skeleton-line skeleton-line--short"));
      body.appendChild(el("span", "skeleton-line"));
      body.appendChild(el("span", "skeleton-line"));
      box.appendChild(body);
      item.appendChild(box);
      grid.appendChild(item);
    }
    grid.setAttribute("aria-busy", "true");
    status.hidden = true;
  }

  function showMessage(message, retryTopic) {
    grid.replaceChildren();
    grid.removeAttribute("aria-busy");
    status.replaceChildren(el("p", "", message));
    if (retryTopic) {
      var button = el("button", "news-retry", "다시 시도");
      button.type = "button";
      button.addEventListener("click", function () { load(retryTopic); });
      status.appendChild(button);
    }
    status.hidden = false;
  }

  function selectTab(topic) {
    tabs.forEach(function (tab) {
      tab.setAttribute("aria-pressed", String(tab.dataset.topic === topic));
    });
  }

  function load(topic) {
    selectTab(topic);
    if (location.protocol === "file:") {
      showMessage("뉴스는 서버 함수를 통해 불러옵니다. 터미널에서 npm run dev 실행 후 http://localhost:8888/news.html 로 열어 주세요.");
      return;
    }
    if (controller) controller.abort();
    controller = new AbortController();
    var current = controller;
    showSkeleton();

    fetch("/api/news?topic=" + encodeURIComponent(topic), { signal: current.signal })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok || !data || !Array.isArray(data.articles)) {
            throw new Error((data && data.error && data.error.message) || "뉴스를 불러오지 못했습니다.");
          }
          return data.articles;
        });
      })
      .then(function (articles) {
        if (current !== controller) return;
        if (!articles.length) {
          showMessage("표시할 뉴스가 없습니다.");
          return;
        }
        grid.replaceChildren.apply(grid, articles.map(card));
        grid.removeAttribute("aria-busy");
        status.hidden = true;
      })
      .catch(function (err) {
        if (err.name === "AbortError" || current !== controller) return;
        showMessage(err.message || "뉴스를 불러오지 못했습니다.", topic);
      });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var topic = tab.dataset.topic;
      history.replaceState(null, "", "?topic=" + encodeURIComponent(topic));
      load(topic);
    });
  });

  var initial = new URLSearchParams(location.search).get("topic");
  load(TOPICS.indexOf(initial) >= 0 ? initial : TOPICS[0]);
})();
