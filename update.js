const fs = require('fs');

// Read currencies
const currenciesOptions = fs.readFileSync('currencies.txt', 'utf8');

// --- UPDATE register.html ---
let registerHtml = fs.readFileSync('register.html', 'utf8');

// 1. Remove SSN field
const ssnRegex = /<div class="col-sm-6">\s*<div class="mb-3">\s*<label for="acct_ssn" class="form-label">SSN <span class="text-danger">\*<\/span><\/label>\s*<input class="form-control" name="acct_ssn" id="acct_ssn"\/>\s*<div class="invalid-feedback">\s*Please Enter SSN\s*<\/div>\s*<\/div>\s*<\/div>/g;
registerHtml = registerHtml.replace(ssnRegex, '');

// 2. Fix Zipcode ID
registerHtml = registerHtml.replace(
  /<label for="acct_ssn" class="form-label">Zipcode <span class="text-danger">\*<\/span><\/label>\s*<input class="form-control" name="zip_code" id="acct_ssn"\/>/g,
  '<label for="zip_code" class="form-label">Zipcode <span class="text-danger">*</span></label>\n                                                            <input class="form-control" name="zip_code" id="zip_code"/>'
);

// 3. Update Currency Dropdown
const currencySelectRegex = /<select class="form-control" name="acct_currency" id="acct_currency" required>[\s\S]*?<\/select>/;
const newCurrencySelect = `<select class="form-control" name="preferred_currency" id="preferred_currency" required>
                                                                <option selected disabled value="">--Select Currency--</option>
${currenciesOptions.split('\n').map(line => '                                                                ' + line).join('\n')}
                                                            </select>`;
registerHtml = registerHtml.replace(currencySelectRegex, newCurrencySelect);

// 4. Remove JS hack
const jsHackRegex = /\/\/ Parse the 3-letter currency code from the selected option text[\s\S]*?currencySelect\.name = "preferred_currency";\s*\}/;
registerHtml = registerHtml.replace(jsHackRegex, '');

fs.writeFileSync('register.html', registerHtml);
console.log('Updated register.html');

// --- UPDATE admin-backoffice/dashboard.html ---
let adminHtml = fs.readFileSync('admin-backoffice/dashboard.html', 'utf8');

const oldAdminOptions = '<option>USD</option><option>EUR</option><option>GBP</option><option>NGN</option><option>AUD</option><option>NZD</option>';
adminHtml = adminHtml.split(oldAdminOptions).join(currenciesOptions.replace(/\n/g, '')); // Replace all instances

fs.writeFileSync('admin-backoffice/dashboard.html', adminHtml);
console.log('Updated admin-backoffice/dashboard.html');
