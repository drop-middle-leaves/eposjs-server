/**
 * Write a program that asks the user for the number of hours worked this week and their hourly
 * rate of pay. If the number of hours worked is greater than 40, then the extra hours are paid
 * at 1.5 times the hourly rate. The program should display an error message if the number
 * of hours is not in the range of 0 to 60.
 */

const readLine = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

var cont = true;

readLine.question("Enter the number of hours worked this week: ", (hours) => {
  if (hours > 60 || hours < 0) {
    console.log(`You entered ${hours}`);
    console.log(
      `This is out of bounds. Please enter a number between 0 and 60.`
    );
  } else {
    console.log(`You entered ${hours}`);
    var hours = parseInt(hours);
    cont = false;
  }
  readLine.close();
});

readLine.question("Enter your hourly rate of pay: ", (rate) => {
  console.log(`You entered ${rate}`);
  var rate = parseInt(rate);
  readLine.close();
});

if (hours > 40) {
  var overtime = hours - 40;
  var hours = hours + overtime * 1.5;
}

var pay = hours * rate;
console.log(`Your pay is ${pay}`);
