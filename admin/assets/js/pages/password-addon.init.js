document.getElementById("password-addon") &&
document.getElementById("password-addon").addEventListener("click", function () {
    var e = document.getElementById("password-input");
    "password" === e.type ? e.type = "text" : e.type = "password"
});


document.getElementById("password-addon1") &&
document.getElementById("password-addon1").addEventListener("click", function () {
    var e = document.getElementById("password-input");
    "password" === e.type ? e.type = "text" : e.type = "password"
});
