import { buildDatabase } from '../engine/dataset.js';

export const TRAINING_CASES = [
  { id: 'standard', name: '业务样本', detail: '电商、用户行为、营销转化、库存履约四种场景。' },
  { id: 'edge', name: '边界样本', detail: 'NULL、重复行为、同名用户、并列价格、零订单日、跨月日期、零分母。' },
  { id: 'empty', name: '空集样本', detail: '所有业务表为空；区分无结果、0 与 NULL。' },
];

export const TRAINING_DATASETS = [
  { id: 'commerce', name: '电商交易', description: '用户 → 订单 → 明细 → 商品。订单数按订单 ID 去重，同名用户按 user_id 区分。', tables: ['users', 'products', 'orders', 'order_items'] },
  { id: 'behavior', name: '用户行为', description: 'events 每行是一条行为日志；同一用户同日可有多条。漏斗要求同用户、同会话且先后有序。', tables: ['events'] },
  { id: 'marketing', name: '营销转化', description: 'campaigns 每行一个活动，leads 每行一条线索，ad_spend 每行活动某天花费。多张一对多表先聚合再连接。', tables: ['campaigns', 'leads', 'ad_spend'] },
  { id: 'fulfillment', name: '库存履约', description: 'inventory 主键为 (sku, warehouse)，shipments 每行一次发货。匹配库存必须同时关联商品与仓库；未签收不计入已签收准时率。', tables: ['inventory', 'shipments'] },
];

const commerceEdge = `
DELETE FROM order_items; DELETE FROM orders; DELETE FROM products; DELETE FROM users;
INSERT INTO users VALUES
 (1,'同名','上海','女',25,'2026-08-01'),(2,'同名','上海','男',30,'2026-08-31'),
 (3,'小周','北京','女',NULL,'2026-09-01'),(4,'无订单',NULL,'男',26,'2026-09-30'),
 (5,'边界','广州','女',25,'2026-10-01'),(6,'零消费','成都','男',20,'2026-08-15');
INSERT INTO products VALUES
 (1,'同价甲','数码',100,NULL),(2,'同价乙','数码',100,0),(3,'便宜','数码',50,40),
 (4,'未售','家居',999,NULL),(5,'空价格','家居',NULL,NULL),(6,'临界','食品',1000,900),
 (7,'并列丙','数码',100,NULL),(8,'分界','食品',499,NULL);
INSERT INTO orders VALUES
 (1,1,'2026-08-31','已完成'),(2,1,'2026-09-01','已完成'),(3,1,'2026-09-01','已完成'),
 (4,2,'2026-09-03','已退款'),(5,2,'2026-10-01','已完成'),(6,3,'2026-10-02','已取消'),
 (7,3,'2026-10-03','已完成'),(8,2,'2026-09-30','已完成'),(9,6,'2026-09-01','已完成');
INSERT INTO order_items VALUES
 (1,1,1,1,100),(2,1,1,1,100),(3,2,2,1,100),(4,3,3,2,50),
 (5,4,4,1,999),(6,5,6,1,1000),(7,6,8,1,499),(8,7,7,1,100),
 (9,8,1,1,100),(10,9,2,1,0);
`;

export function buildEnrichmentDatabase(runtime, caseID = 'standard') {
  if (!TRAINING_CASES.some(item => item.id === caseID)) throw new Error('未知训练样本');
  const database = buildDatabase(runtime);
  database.exec(`
    CREATE TABLE events(event_id INTEGER PRIMARY KEY,user_id INTEGER,session_id TEXT,event_name TEXT,event_time TEXT);
    CREATE TABLE campaigns(campaign_id INTEGER PRIMARY KEY,campaign_name TEXT,channel TEXT);
    CREATE TABLE leads(lead_id INTEGER PRIMARY KEY,campaign_id INTEGER,created_at TEXT,converted_at TEXT,amount REAL);
    CREATE TABLE ad_spend(campaign_id INTEGER,spend_date TEXT,cost REAL,PRIMARY KEY(campaign_id,spend_date));
    CREATE TABLE inventory(sku TEXT,warehouse TEXT,quantity INTEGER,reorder_level INTEGER,PRIMARY KEY(sku,warehouse));
    CREATE TABLE shipments(shipment_id INTEGER PRIMARY KEY,sku TEXT,warehouse TEXT,quantity INTEGER,shipped_at TEXT,promised_at TEXT,delivered_at TEXT);
    INSERT INTO campaigns VALUES (1,'秋季搜索','搜索'),(2,'内容种草','内容'),(3,'社群召回','私域'),(4,'未投放','搜索');
    INSERT INTO leads VALUES
      (1,1,'2026-08-31',NULL,NULL),(2,1,'2026-09-01','2026-09-02',200),
      (3,1,'2026-09-01','2026-09-03',200),(4,2,'2026-09-03','2026-10-01',300),
      (5,2,'2026-09-30',NULL,NULL),(6,3,'2026-10-01','2026-10-01',0);
    INSERT INTO ad_spend VALUES (1,'2026-08-31',100),(1,'2026-09-01',100),(1,'2026-09-03',50),
      (2,'2026-09-01',200),(2,'2026-10-01',0),(3,'2026-09-01',0);
    INSERT INTO inventory VALUES ('A','华东',10,5),('A','华南',0,5),('B','华东',3,5),('C','华南',3,3),('D','华东',0,0);
    INSERT INTO shipments VALUES
      (1,'A','华东',2,'2026-08-31','2026-09-01','2026-09-01'),
      (2,'A','华东',3,'2026-09-01','2026-09-02','2026-09-03'),
      (3,'A','华南',1,'2026-09-01','2026-09-02',NULL),
      (4,'B','华东',1,'2026-09-03','2026-09-05','2026-09-05');
    INSERT INTO events VALUES
      (1,1,'s1','login','2026-08-31 08:00:00'),(2,1,'s2','login','2026-09-01 08:00:00'),
      (3,1,'s2','login','2026-09-01 08:01:00'),(4,1,'s3','login','2026-09-02 08:00:00'),
      (5,2,'s4','login','2026-09-01 08:00:00'),(6,2,'s5','login','2026-09-03 08:00:00'),
      (7,1,'a','view','2026-09-01 09:00:00'),(8,1,'a','view','2026-09-01 09:01:00'),
      (9,1,'a','cart','2026-09-01 09:02:00'),(10,1,'a','pay','2026-09-01 09:03:00'),
      (11,2,'b','cart','2026-09-01 09:00:00'),(12,2,'b','view','2026-09-01 09:01:00'),
      (13,2,'b','pay','2026-09-01 09:02:00'),(14,3,'c','view','2026-09-01 09:00:00'),
      (15,3,'d','cart','2026-09-01 09:01:00'),(16,3,'d','pay','2026-09-01 09:02:00'),
      (17,4,'e','view','2026-09-01 09:00:00'),(18,4,'e','cart','2026-09-01 09:00:00');
  `);
  if (caseID === 'edge') {
    database.exec(commerceEdge);
    database.exec(`
      INSERT INTO events VALUES (19,5,NULL,'login','2026-09-30 12:00:00'),(20,5,'x','login','2026-10-01 12:00:00'),
        (21,5,'y','login','2026-10-02 12:00:00'),(22,5,'z','login','2026-10-03 12:00:00'),
        (23,1,'a','pay','2026-09-01 09:03:00'),(24,6,'f','view','2026-10-01 09:00:00'),
        (25,6,'f','cart','2026-10-01 09:01:00'),(26,6,'f','pay','2026-10-01 09:02:00');
      INSERT INTO leads VALUES (7,4,'2026-10-01',NULL,NULL),(8,3,'2026-09-30','2026-10-01',300);
      UPDATE ad_spend SET cost=0;
      INSERT INTO shipments VALUES (5,'C','华南',1,'2026-09-30','2026-10-01','2026-10-02');
    `);
  }
  if (caseID === 'empty') {
    for (const table of [...TRAINING_DATASETS.flatMap(item => item.tables)]) database.run('DELETE FROM ' + table);
  }
  return database;
}
