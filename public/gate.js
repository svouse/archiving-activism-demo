(function () {
  try {
    if (localStorage.getItem('aa_access') === 'granted') return;
  } catch (e) {}
  location.replace('/coming-soon.html');
})();
