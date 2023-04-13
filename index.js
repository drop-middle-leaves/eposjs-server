// Pull in required dependencies, including the connection to the PostgreSQL database
const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*",
  },
});

const pool = require("./db.js");
require("dotenv").config();
const { Client, Environment } = require("square");

// Create a Square client
const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: Environment.Sandbox,
});

// Middleware
app.use(express.json()); //req.body

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*"); // Accept from any domain
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

// Websocket connection
io.on("connection", (socket) => {
  // Listen for incoming data on the "currentTill" channel
  socket.on("currentTill", (data) => {
    // Broadcast data to all connected clients
    io.emit("currentTill", data);
  });

  socket.on("currentSelected", (data) => {
    // Broadcast data to all connected clients
    io.emit("currentSelected", data);
  });

  socket.on("paymentURL", (data) => {
    // Broadcast data to all connected clients
    console.log(data);
    io.emit("paymentURL", data);
  });
});

// Routes

// Create a new order
app.post("/orderCreate", async (req, res, next) => {
  try {
    //retrieve the required data from the front end
    const { orderItems } = req.body;

    // Create Payment Link in Square
    try {
      // Create unique key for Square (not used outside the api call)
      const idempotencyKey = require("crypto").randomBytes(22).toString("hex");

      // Create order json
      let order = {
        idempotencyKey: idempotencyKey,
        order: {
          locationId: process.env.SQUARE_LOCATION_ID,
          lineItems: [],
          idempotencyKey: idempotencyKey,
        },
      };

      // Add line items to order
      for (const key of orderItems) {
        // Get product name from database
        const nameQuery = await pool.query(
          "SELECT description FROM product WHERE EAN = $1",
          [key.EAN]
        );
        const name = nameQuery.rows[0].description;

        // Check if a custom price has been set
        if (key.customPrice) {
          var price = parseFloat(key.customPrice);
        } else {
          // Get product price from database
          const priceQuery = await pool.query(
            "SELECT priceHistory.gross FROM priceHistory JOIN product ON priceHistory.product_fk = product.product_pk WHERE ((product.EAN = $1) AND (((priceHistory.startDate <= CURRENT_TIMESTAMP) AND (priceHistory.endDate IS NULL)) OR ((priceHistory.startDate <= CURRENT_TIMESTAMP) AND (priceHistory.endDate > CURRENT_TIMESTAMP))));",
            [key.EAN]
          );
          var price = parseFloat(priceQuery.rows[0].gross);
        }

        // Check if a discount has been applied
        if (key.Discount) {
          price = price - price * (key.Discount / 100);
        }

        // Convert price to pence
        price = BigInt(price.toFixed(2) * 100);

        // Create JSON for line item
        const lineItems = {
          name: name,
          quantity: String(key.Quantity),
          basePriceMoney: {
            amount: price,
            currency: "GBP",
          },
        };
        // Add JSON to Order
        order.order.lineItems.push(lineItems);
      }

      const response = await client.checkoutApi.createPaymentLink(order);

      // Parses the JSON return value into something JS can use
      const jsonResponse = JSON.parse(response.body);

      // Sets the order_id and payment link to variables for use when committing to DB and returning to front end
      var order_id = jsonResponse.payment_link.order_id;
      var paymentLink = jsonResponse.payment_link.url;
    } catch (ApiError) {
      throw ApiError;
    }

    //create a new order in orders table
    const newOrder = await pool.query(
      "INSERT INTO orders (order_id) VALUES($1) RETURNING *",
      [order_id]
    );

    //get the order_pk of the new order
    var order_pk = newOrder.rows[0].order_pk;

    //Create a new order item in order_items table for each item in the orde
    for (const key of orderItems) {
      //Find the product_pk of the EAN for creating the order item
      var product_fk = await pool.query(
        "SELECT product_pk FROM product WHERE EAN = $1",
        [key.EAN]
      );
      product_fk = product_fk.rows[0].product_pk;

      //Create the new order item
      const orderItemRequest = await pool.query(
        "INSERT INTO order_item (order_fk, product_fk, quantity) VALUES($1, $2, $3) RETURNING *",
        [order_pk, product_fk, key.Quantity]
      );

      // If a discount has been applied, update the record in the order_item table
      if (key.Discount) {
        await pool.query(
          "UPDATE order_item SET percentagemodifier = $1 WHERE order_item_pk = $2",
          [key.Discount, orderItemRequest.rows[0].order_item_pk]
        );
      }

      // If a custom price has been applied, update the record in the order_item table
      if (key.customPrice) {
        await pool.query(
          "UPDATE order_item SET customPrice = $1 WHERE order_item_pk = $2",
          [key.customPrice, orderItemRequest.rows[0].order_item_pk]
        );
      }
    }

    // Create a JSON object to return to the front end

    let returnData = {
      paymentLink: paymentLink,
      order_id: order_id,
    };

    //return the data
    res.json(returnData);
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

app.post("/search", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    let { search } = req.body;

    // Allows for searching for products with various parts missing
    // Split string
    search = search.split(" ");
    // Add % to each word
    for (let i = 0; i < search.length; i++) {
      search[i] = "%" + search[i] + "%";
    }
    // Join string
    search = search.join(" ");
    // Create an array to store the data to be returned
    let returnData = [];

    // Search for products
    const products = await pool.query(
      "SELECT * FROM product WHERE description LIKE $1",
      [search]
    );
    // Add products to return data
    for (const key of products.rows) {
      returnData.push({
        EAN: key.ean,
        Description: key.description,
      });
    }

    //return the data
    res.json(returnData);
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

app.post("/paymentCheck", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    let { orderID } = req.body;

    // Check with database
    const isSettled = await pool.query(
      "SELECT issettled FROM orders WHERE order_id = $1",
      [orderID]
    );
    const isSettledBool = isSettled.rows[0].issettled;

    //return the data
    res.json(isSettledBool);
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

app.post("/cancelOrder", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    let { orderID } = req.body;

    // Find the order_pk of the order to be cancelled
    const order_pk = await pool.query(
      "SELECT order_pk FROM orders WHERE order_id = $1",
      [orderID]
    );
    const order_pk_int = order_pk.rows[0].order_pk;

    // Delete the order items from the order_items table
    await pool.query("DELETE FROM order_item WHERE order_fk = $1", [
      order_pk_int,
    ]);

    // Delete the order from the orders table
    await pool.query("DELETE FROM orders WHERE order_id = $1", [orderID]);

    // Return the data
    res.json("Order cancelled");
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

app.post("/refund", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    const { paymentID, EANs } = req.body;

    // Get order_pk from database
    const order_pk = await pool.query(
      "SELECT order_pk FROM orders WHERE payment_id = $1",
      [paymentID]
    );
    const order_pk_int = order_pk.rows[0].order_pk;

    // Throw error if undefined
    if (order_pk_int == undefined) {
      throw new Error("Order does not exist, or is not settled");
    }

    // Get ordertime
    const orderTime = await pool.query(
      "SELECT ordertime FROM orders WHERE payment_id = $1",
      [paymentID]
    );
    const orderTimeVal = orderTime.rows[0].ordertime;

    refund = [];
    // Check if the order items exist
    for (const key of EANs) {
      // Get product_pk from database
      const product_fk = await pool.query(
        "SELECT product_pk FROM product WHERE ean = $1",
        [key.EAN]
      );
      const product_fk_int = product_fk.rows[0].product_pk;

      // Get order_item_pk from database
      const orderItemRequest = await pool.query(
        "SELECT order_item_pk FROM order_item WHERE order_fk = $1 AND product_fk = $2",
        [order_pk_int, product_fk_int]
      );
      const orderItemRequestInt = orderItemRequest.rows[0].order_item_pk;

      // Throw error if undefined
      if (orderItemRequest.rows[0] == undefined) {
        throw new Error("Order item $1 does not exist", [key.EAN]);
      }

      // Ensure quantity to be refunded is correct.
      if (key.Quantity > orderItemRequest.rows[0].quantity) {
        throw new Error(
          "Quantity to be refunded is greater than quantity in order"
        );
      }

      // Get custom price from database
      const customPrice = await pool.query(
        "SELECT customprice FROM order_item WHERE order_item_pk = $1",
        [orderItemRequestInt]
      );
      // If the custom price is not null, use it
      if (customPrice.rows[0].price != null) {
        var priceVal = customPrice.rows[0].price;
      } else {
        // Else get price from priceHistory at time of purchase
        const price = await pool.query(
          "SELECT priceHistory.gross FROM priceHistory JOIN product ON priceHistory.product_fk = product.product_pk WHERE ((product.EAN = $1) AND (((priceHistory.startDate <= $2) AND (priceHistory.endDate IS NULL)) OR ((priceHistory.startDate <= $2) AND (priceHistory.endDate >= $2))))",
          [key.EAN, orderTimeVal]
        );
        var priceVal = price.rows[0].gross;
      }

      // If a discount was applied, get and apply discount
      const discount = await pool.query(
        "SELECT percentagemodifier FROM order_item WHERE order_item_pk = $1",
        [orderItemRequestInt]
      );
      if (discount.rows[0].percentagemodifier != null) {
        priceVal = priceVal * (1 - discount.rows[0].percentagemodifier / 100);
      }

      // Add to refund array
      refund.push({
        product_pk: product_fk_int,
        quantity: key.Quantity,
        price: priceVal,
      });
    }

    // Generate idempotency key
    const idempotencyKey = require("crypto").randomBytes(22).toString("hex");

    // Add up the total refund amount
    let totalRefund = 0;
    for (const key of refund) {
      totalRefund += key.price * key.quantity;
    }
    // Times by 100 to convert to pence
    totalRefund = totalRefund * 100;

    // Create a refund
    try {
      const response = await client.refundsApi.refundPayment({
        idempotencyKey: idempotencyKey,
        amountMoney: {
          amount: totalRefund,
          currency: "GBP",
        },
        paymentId: paymentID,
      });

      if (response.result.refund.status == "PENDING") {
        // Remove the refunded items from the order
        for (const key of refund) {
          await pool.query(
            "UPDATE order_item SET quantity = quantity - $1 WHERE order_fk = $2 AND product_fk = $3",
            [key.quantity, order_pk_int, key.product_pk]
          );
          // If the quantity is now 0, delete the order item
          const quantity = await pool.query(
            "SELECT quantity FROM order_item WHERE order_fk = $1 AND product_fk = $2",
            [order_pk_int, key.product_pk]
          );
          if (quantity.rows[0].quantity == 0) {
            await pool.query(
              "DELETE FROM order_item WHERE order_fk = $1 AND product_fk = $2",
              [order_pk_int, key.product_pk]
            );
          }

          // Update stock levels
          await pool.query(
            "UPDATE product SET stock = stock + $1 WHERE product_pk = $2",
            [key.quantity, key.product_pk]
          );
        }

        // If the order is now empty, delete the order
        const orderItems = await pool.query(
          "SELECT * FROM order_item WHERE order_fk = $1",
          [order_pk_int]
        );
        if (orderItems.rows.length == 0) {
          await pool.query("DELETE FROM orders WHERE order_pk = $1", [
            order_pk_int,
          ]);
        }
        res.json("Refund successful");
      } else {
        throw new Error("Refund failed");
      }
    } catch (error) {
      throw new Error(error);
    }
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

app.post("/getEanInfo", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    let { EAN } = req.body;

    // Create an array to store the data to be returned
    let returnData = [];

    // Get product name and price from database
    let name = await pool.query(
      "SELECT description FROM product WHERE EAN = $1",
      [EAN]
    );
    name = name.rows[0].description;
    let price = await pool.query(
      "SELECT priceHistory.gross FROM priceHistory JOIN product ON priceHistory.product_fk = product.product_pk WHERE ((product.EAN = $1) AND (((priceHistory.startDate <= CURRENT_TIMESTAMP) AND (priceHistory.endDate IS NULL)) OR ((priceHistory.startDate <= CURRENT_TIMESTAMP) AND (priceHistory.endDate > CURRENT_TIMESTAMP))));",
      [EAN]
    );
    price = price.rows[0].gross;
    let stock = await pool.query("SELECT stock FROM product WHERE EAN = $1", [
      EAN,
    ]);
    stock = stock.rows[0].stock;

    // Add products to return data
    returnData.push({
      EAN: EAN,
      Description: name,
      Price: price,
      Stock: stock,
    });

    // Return the data
    res.json(returnData);
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

app.post("/getOrderInfo", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    let { order_id } = req.body;

    // Get order info from database
    let order = await pool.query("SELECT * FROM orders WHERE order_id = $1", [
      order_id,
    ]);
    order = order.rows[0];
    // Get order time from database
    let orderTime = await pool.query(
      "SELECT orderTime FROM orders WHERE order_id = $1",
      [order_id]
    );
    orderTime = orderTime.rows[0].ordertime;

    // Create order json
    let returnData = {
      isSale: order.issale,
      isSettled: order.issettled,
      orderItems: [],
    };

    // Get order items from database
    let orderItems = await pool.query(
      "SELECT * FROM order_item WHERE order_fk = $1",
      [order.order_pk]
    );
    for (const key of orderItems.rows) {
      // Get product name
      let name = await pool.query(
        "SELECT * FROM product WHERE product_pk = $1",
        [key.product_fk]
      );
      name = name.rows[0].description;

      // Get price from database at the time of the order
      let price = await pool.query(
        "SELECT priceHistory.gross, priceHistory.endDate FROM priceHistory JOIN product ON priceHistory.product_fk = product.product_pk WHERE ((product.product_pk = $1) AND (((priceHistory.startDate <= $2) AND (priceHistory.endDate IS NULL)) OR ((priceHistory.startDate <= $2) AND (priceHistory.endDate > $2))));",
        [key.product_fk, orderTime]
      );
      price = price.rows[0].gross;

      returnData.orderItems.push({
        product: name,
        quantity: key.quantity,
        price: price,
        percentageModifier: key.percentageModifier,
      });
    }

    // Return the data
    res.json(returnData);
  } catch (err) {
    res.json(err.message);
    console.error(err.message);
  }
});

http.listen(5200, () => {
  console.log("Server is running on port 5200");
});

// Webhook for Square

// Initialise express and define a port
const hook = express();

// Tell express to use body-parser's JSON parsing
hook.use(bodyParser.json());

// Start express on the defined port
hook.listen(3000, () => console.log(`EposJS Webhook listening on port 3000!`));

// Listen for POST requests to the / endpoint
hook.post("/", async (req, res) => {
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
