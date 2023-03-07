// Pull in required dependencies, including the connection to the PostgreSQL database
const express = require("express");
const app = express();
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
          "UPDATE order_item SET discount = $1 WHERE order_item_pk = $2",
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

app.post("/refund", async (req, res, next) => {
  try {
    // Retrieve the required data from the front end
    const { order_id } = req.body;

    // Get payment_id from database
    const payment_id = await pool.query(
      "SELECT payment_id FROM orders WHERE order_id = $1",
      [order_id]
    );
    const payment_id_string = payment_id.rows[0].payment_id;

    // Create unique key for Square (not used outside the api call)
    const idempotencyKey = require("crypto").randomBytes(22).toString("hex");
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
    console.log(search);

    // Create an array to store the data to be returned
    let returnData = [];

    // Search for products
    const products = await pool.query(
      "SELECT * FROM product WHERE description LIKE $1",
      [search]
    );
    console.log(products.rows);
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

app.listen(5200, () => {
  console.log("Server is running on port 5200");
});
