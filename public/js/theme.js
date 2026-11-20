// 낮/밤 테마 전환
// <head> 에서 바로 실행해 첫 화면이 그려지기 전에 테마를 정한다 (깜빡임 방지).
// 우선순위: 사용자가 버튼으로 고른 값(localStorage) → 기기 설정(prefers-color-scheme)
(function () {
  var STORAGE_KEY = "theme";
  var THEME_COLORS = { light: "#ffffff", dark: "#121212" };
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function stored() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : null;
    } catch (err) {
      return null; // 사생활 보호 모드 등 저장소를 못 쓰는 환경
    }
  }

  function systemTheme() {
    return media && media.matches ? "dark" : "light";
  }

  function apply(theme) {
    root.dataset.theme = theme;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].content = THEME_COLORS[theme];

    var button = document.getElementById("theme-toggle");
    if (!button) return;
    var next = theme === "dark" ? "라이트" : "다크";
    button.setAttribute("aria-label", next + " 모드로 전환");
    button.title = next + " 모드로 전환";
    button.setAttribute("aria-pressed", String(theme === "dark"));
  }

  apply(stored() || systemTheme());

  document.addEventListener("DOMContentLoaded", function () {
    apply(root.dataset.theme);
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    button.addEventListener("click", function () {
      var theme = root.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (err) {
        // 저장 실패 시 이번 페이지에서만 적용
      }
      apply(theme);
    });
  });

  // 직접 고른 적이 없으면 기기 설정 변경을 따라간다
  if (media && media.addEventListener) {
    media.addEventListener("change", function () {
      if (!stored()) apply(systemTheme());
    });
  }
})();
