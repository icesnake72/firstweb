// 모바일 GNB: 메뉴 링크를 드롭다운으로 접고 편다 (넓은 화면에서는 버튼이 숨겨져 동작하지 않음)
(function () {
  var nav = document.querySelector("nav");
  var toggle = document.getElementById("nav-toggle");
  var menu = document.getElementById("nav-menu");
  if (!nav || !toggle || !menu) return;

  function setOpen(open) {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
  }

  function isOpen() {
    return nav.classList.contains("is-open");
  }

  toggle.addEventListener("click", function () {
    setOpen(!isOpen());
  });

  // 메뉴 항목을 고르면 닫는다 (같은 페이지 안 앵커 이동 포함)
  menu.addEventListener("click", function (event) {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", function (event) {
    if (isOpen() && !menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  // 화면이 넓어지면 열린 상태를 정리한다
  if (window.matchMedia) {
    var wide = window.matchMedia("(min-width: 601px)");
    var onChange = function () { if (wide.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener("change", onChange);
  }
})();
