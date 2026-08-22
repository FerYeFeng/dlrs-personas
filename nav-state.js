(function () {
  try {
    if (sessionStorage.getItem("dlrs-nav-open") === "1") {
      document.documentElement.classList.add("nav-open-initial");
    }
  } catch {}
})();
