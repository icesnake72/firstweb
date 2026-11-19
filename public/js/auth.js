// 카카오 로그인 상태 표시
(function () {
  var loginBtn = document.getElementById("auth-login");
  var userBox = document.getElementById("auth-user");
  var toast = document.getElementById("toast");

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    setTimeout(function () { toast.hidden = true; }, 3500);
  }

  // 로그인 결과 안내 후 주소창의 ?login=... 정리
  var params = new URLSearchParams(location.search);
  var result = params.get("login");
  if (result) {
    var reasons = {
      access_denied: "카카오 로그인을 취소했습니다.",
      invalid_state: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
      token: "카카오 인증에 실패했습니다. 설정(Redirect URI, Client Secret)을 확인해 주세요.",
      profile: "카카오 사용자 정보를 가져오지 못했습니다."
    };
    showToast(result === "success"
      ? "카카오 로그인되었습니다."
      : (reasons[params.get("reason")] || "로그인 중 오류가 발생했습니다."));
    history.replaceState(null, "", location.pathname + location.hash);
  }

  // 파일로 직접 열었을 때(file://)는 서버 함수가 없으므로 건너뜀
  if (location.protocol === "file:") return;

  fetch("/api/me", { credentials: "same-origin", cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : { loggedIn: false }; })
    .then(function (data) {
      if (!data.loggedIn) return;
      var u = data.user;
      document.getElementById("auth-name").textContent = u.nickname;
      var avatar = document.getElementById("auth-avatar");
      if (u.image) { avatar.src = u.image; avatar.alt = u.nickname + " 프로필 사진"; }
      else { avatar.hidden = true; }
      loginBtn.hidden = true;
      userBox.hidden = false;
    })
    .catch(function () { /* 함수가 없는 환경: 로그인 버튼 그대로 */ });
})();
