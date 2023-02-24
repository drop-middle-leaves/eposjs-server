const pool = require("./db.js");
itemsToAdd = [
  [3, "Coffee", 1, 100, 2, 2.4],
  [4, "Lottery Ticket", 1, 100, 1, 1.2],
  [5, "Dispensed Pop", 1, 100, 1.5, 1.8],
  [6, "Prime", 1, 20, 20, 24],
  [7, "Sausage Roll", 1, 100, 2, 2.4],
  [8, "Straw", 1, 2500, 0.1, 0.12],
];

async function addItem(item) {
  const addProducts = await pool.query(
    "INSERT INTO product(ean, description, vat_fk, stock) VALUES($1, $2, $3, $4) RETURNING *",
    [item[0], item[1], item[2], item[3]]
  );
  const addProductPrice = await pool.query(
    "INSERT INTO priceHistory(product_fk, startdate, net, gross, description) VALUES($1, CURRENT_TIMESTAMP, $2, $3, $4) RETURNING *",
    [addProducts.rows[0].product_pk, item[4], item[5], "new product"]
  );
  console.log(addProducts.rows[0]);
  console.log(addProductPrice.rows[0]);
}

for (i in itemsToAdd) {
  addItem(itemsToAdd[i]);
}
