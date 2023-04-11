// Require express and body-parser
const express = require("express");
const bodyParser = require("body-parser");
const pool = require("./db.js");

// Initialise express and define a port
const app = express();
const port = 3000;

// Tell express to use body-parser's JSON parsing
app.use(bodyParser.json());

// Start express on the defined port
app.listen(port, () =>
  console.log(`EposJS Webhook listening on port ${port}!`)
);

// Listen for POST requests to the / endpoint
app.post("/", async (req, res) => {
  // Retrieve the event data from the request
  const event = req.body;

  // If the event type is 'payment.updated'
  if (event.type === "payment.updated") {
    // If payment is confirmed
    let isSettled = await pool.query(
      "SELECT issettled FROM orders WHERE order_id = $1",
      [event.data.object.payment.order_id]
    );

    console.log(isSettled.rows);

    if (isSettled.rows.length !== 0) {
      isSettled = isSettled.rows[0].issettled;
      console.log(1);
    } else {
      isSettled = true;
      console.log(2);
    }

    if (event.data.object.payment.status === "COMPLETED" && !isSettled) {
      // Retrieve the order ID from the payment
      const order_id = event.data.object.payment.order_id;
      // Update the order status to 'paid'
      await pool.query(
        "UPDATE orders SET issettled = true WHERE order_id = $1",
        [order_id]
      );
      // Update payment_id in orders table
      pool.query("UPDATE orders SET payment_id = $1 WHERE order_id = $2", [
        event.data.object.payment.id,
        order_id,
      ]);

      // Update stock levels
      // Get order primary key
      let order_pk = await pool.query(
        "SELECT order_pk FROM orders WHERE order_id = $1",
        [order_id]
      );
      order_pk = order_pk.rows[0].order_pk;

      // Get order items
      let orderItems = await pool.query(
        "SELECT * FROM order_item WHERE order_fk = $1",
        [order_pk]
      );
      orderItems = orderItems.rows;

      // For each order item
      for (const key of orderItems) {
        // Get product primary key
        let product_pk = await pool.query(
          "SELECT product_pk FROM product WHERE product_pk = $1",
          [key.product_fk]
        );
        product_pk = product_pk.rows[0].product_pk;

        // Get current stock level
        let currentStock = await pool.query(
          "SELECT stock FROM product WHERE product_pk = $1",
          [product_pk]
        );
        currentStock = currentStock.rows[0].stock;

        // Update stock level
        pool.query("UPDATE product SET stock = $1 WHERE product_pk = $2", [
          currentStock - key.quantity,
          product_pk,
        ]);
      }
    }
  }

  // Return a 200 OK response to the webhook
  res.sendStatus(200);
});
