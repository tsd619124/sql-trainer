function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
var RND=mulberry32(20261021);
function rint(lo,hi){return lo+Math.floor(RND()*(hi-lo+1))}
function pick(arr){return arr[Math.floor(RND()*arr.length)]}
function fmtDay(ms){return new Date(ms).toISOString().slice(0,10)}

function buildProductRows(){
  return [
    [1,'无线降噪耳机','数码',899,799],[2,'智能手表 Pro','数码',1499,null],
    [3,'便携充电宝','数码',129,null],[4,'机械键盘','数码',499,449],
    [5,'记忆棉枕头','家居',199,null],[6,'落地阅读灯','家居',329,null],
    [7,'收纳箱套装','家居',89,79],[8,'电动升降桌','家居',1899,null],
    [9,'摇粒绒外套','服饰',259,null],[10,'修身牛仔裤','服饰',179,null],
    [11,'运动短袖T恤','服饰',79,69],[12,'羊毛围巾','服饰',159,null],
    [13,'每日坚果礼盒','食品',99,null],[14,'冷榨橄榄油','食品',139,null],
    [15,'手冲咖啡豆','食品',89,79],[16,'黑巧克力礼盒','食品',59,null],
    [17,'氨基酸洁面','美妆',69,null],[18,'玻尿酸精华','美妆',299,269],
    [19,'修护面膜盒','美妆',129,null],[20,'口红套盒','美妆',349,null]
  ];
}

var NO_ORDER_PRODUCTS={8:true,12:true};

function buildDatabase(SQL){
  RND=mulberry32(20261021);
  var db=new SQL.Database();
  db.exec("CREATE TABLE users(user_id INTEGER PRIMARY KEY, name TEXT, city TEXT, gender TEXT, age INTEGER, register_date TEXT);"
    +"CREATE TABLE products(product_id INTEGER PRIMARY KEY, product_name TEXT, category TEXT, price REAL, discount_price REAL);"
    +"CREATE TABLE orders(order_id INTEGER PRIMARY KEY, user_id INTEGER, order_date TEXT, status TEXT);"
    +"CREATE TABLE order_items(item_id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, quantity INTEGER, unit_price REAL);");
  function ins(t,cols,rows){
    var st=db.prepare('INSERT INTO '+t+' ('+cols.join(',')+') VALUES ('+cols.map(function(){return '?'}).join(',')+')');
    rows.forEach(function(r){st.run(r)});
    st.free();
  }
  var products=buildProductRows();
  ins('products',['product_id','product_name','category','price','discount_price'],products);
  var priceOf={}; products.forEach(function(p){priceOf[p[0]]=p[3]});

  var CITIES=['北京','上海','广州','深圳','杭州','成都'];
  var SURNAMES='王李张刘陈杨赵黄周吴徐孙马朱胡林郭何高罗郑'.split('');
  var GIVEN=['伟','芳','娜','敏','静','磊','军','洋','勇','艳','杰','涛','明','超','秀英','霞','平','刚','桂英','文博','思远','雨桐','子轩','浩然','欣怡','梓萱','诗涵','宇航','若曦','博文'];
  var users=[];
  var fixedCity={3:'北京',4:'广州',5:'深圳',6:'杭州',7:'成都'};
  var REG0=Date.UTC(2026,6,1),REG1=Date.UTC(2026,8,30),AUG0=Date.UTC(2026,7,1),AUG1=Date.UTC(2026,7,31);
  for(var i=0;i<30;i++){
    var reg;
    if(i>=14&&i<=21){reg=fmtDay(AUG0+rint(0,Math.round((AUG1-AUG0)/86400000))*86400000)}
    else{reg=fmtDay(REG0+rint(0,Math.round((REG1-REG0)/86400000))*86400000)}
    var city=i<3?'上海':(fixedCity[i]||pick(CITIES));
    users.push([i+1,SURNAMES[i%20]+GIVEN[i],city,pick(['男','女']),rint(20,45),reg]);
  }
  ins('users',['user_id','name','city','gender','age','register_date'],users);

  var pool=[];products.forEach(function(p){if(!NO_ORDER_PRODUCTS[p[0]])pool.push(p[0])});
  var orders=[],items=[],oid=1000,iid=1;
  var ORD0=Date.UTC(2026,7,1),ORD1=Date.UTC(2026,9,20);
  var span=Math.round((ORD1-ORD0)/86400000);
  for(var n=0;n<220;n++){
    var uid=RND()<0.55?rint(1,10):rint(11,28);
    var odate=fmtDay(ORD0+rint(0,span)*86400000);
    var sr=RND();
    var status=sr<0.78?'已完成':(sr<0.9?'已取消':'已退款');
    orders.push([oid,uid,odate,status]);
    var ir=RND();
    var cnt=ir<0.5?1:(ir<0.85?2:3);
    for(var k=0;k<cnt;k++){
      var pid2=pick(pool);
      items.push([iid,oid,pid2,rint(1,3),priceOf[pid2]]);
      iid++;
    }
    oid++;
  }
  ins('orders',['order_id','user_id','order_date','status'],orders);
  ins('order_items',['item_id','order_id','product_id','quantity','unit_price'],items);
  return db;
}


export { buildDatabase, buildProductRows };
