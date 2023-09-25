CREATE DATABASE jsepos;

CREATE TABLE orders (good they 
    order_pk SERIAL PRIMARY KEY,
    order_id VARCHAR(255) NULL,
    isSettled BOOLEAN DEFAULT(FALSE) NOT NULL,
    orderTime TIMESTAMP DEFAULT(CURRENT_TIMESTAMP) NOT NULL,
    payment_id CHARACTER VARCHAR(255) NULL,
);

CREATE TABLE order_item (
    order_item_pk SERIAL PRIMARY KEY,
    order_fk BIGINT NOT NULL,
    product_fk BIGINT NOT NULL,
    quantity INT NOT NULL,
    percentageModifier DECIMAL NULL,
    customPrice numeric(10,2) NULL,
    FOREIGN KEY (order_fk) REFERENCES orders(order_pk),
    FOREIGN KEY (product_fk) REFERENCES product(product_pk)
);

CREATE TABLE product (
    product_pk SERIAL PRIMARY KEY,
    EAN BIGINT NOT NULL,
    description VARCHAR(255) NOT NULL,
    vat_fk BIGINT NOT NULL,
    stock INT NOT NULL,
    FOREIGN KEY (vat_fk) REFERENCES vat(vat_pk)
);

CREATE TABLE vat (
    vat_pk SERIAL PRIMARY KEY,
    vatCode INTEGER NOT NULL,
    vatRate DECIMAL(10,2) NOT NULL
);

CREATE TABLE priceHistory (
    priceHistory_pk SERIAL PRIMARY KEY,
    product_fk BIGINT NOT NULL,
    startDate TIMESTAMP NOT NULL,
    endDate TIMESTAMP NULL,
    net DECIMAL(10,2) NOT NULL,
    gross DECIMAL(10,2) NOT NULL,
    description VARCHAR(255) NOT NULL,
    FOREIGN KEY (product_fk) REFERENCES product(product_pk)
);