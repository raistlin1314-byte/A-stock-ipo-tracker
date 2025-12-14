// scripts/fetch-ipo-data.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 辅助函数：将日期格式化为 YYYYMMDD (Tushare专用)
function formatDateForTushare(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

// 辅助函数：将 YYYYMMDD 转换为 YYYY-MM-DD (前端显示用)
function formatTushareDateToDisplay(dateStr) {
    if (!dateStr) return '待定';
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

// 使用Tushare API获取数据
async function fetchIpoDataFromTushare() {
    const token = process.env.TUSHARE_TOKEN;
    if (!token) {
        throw new Error("Tushare Token未配置");
    }

    try {
        // 请求未来30天的数据
        const startDate = formatDateForTushare(new Date()); 
        const endDate = formatDateForTushare(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); 
        
        console.log(`DEBUG: 正在请求 Tushare API...`);

        // 调用Tushare API (注意使用 http 避免SSL报错)
        const response = await axios.post('http://api.tushare.pro', {
            api_name: 'new_share',
            token: token,
            params: {
                start_date: startDate,
                end_date: endDate
            },
            fields: 'ts_code,name,ipo_date,issue_date,amount,market,price,pe,limit_amount,funds,ballot' 
        });

        if (response.data?.data?.items && Array.isArray(response.data.data.items)) {
            const rawItems = response.data.data.items;
            const fields = response.data.data.fields; // 获取字段定义 ['ts_code', 'name', ...]
            
            console.log(`DEBUG: 获取到 ${rawItems.length} 条原始数据`);

            // --- 关键修复：将数组转为对象 ---
            const transformedData = rawItems.map(itemArray => {
                // 将字段名和值对应起来
                const itemObj = {};
                fields.forEach((field, index) => {
                    itemObj[field] = itemArray[index];
                });

                return {
                    name: itemObj.name || '未知',
                    code: itemObj.ts_code ? itemObj.ts_code.split('.')[0] : '未知',
                    date: formatTushareDateToDisplay(itemObj.ipo_date), 
                    market: itemObj.market || 'A股',
                    price: itemObj.price ? parseFloat(itemObj.price) : null,
                    maxSubscription: itemObj.limit_amount ? parseInt(itemObj.limit_amount * 10000) : 0, 
                    requiredMarketValue: { shanghai: 0, shenzhen: 0 }, 
                    industry: '待定', 
                    peRatio: itemObj.pe ? parseFloat(itemObj.pe) : '待定',
                    expectedFundraise: itemObj.funds ? itemObj.funds + '亿' : '待定',
                    listingDate: formatTushareDateToDisplay(itemObj.issue_date)
                };
            });

            // 过滤掉日期为空的
            const validData = transformedData.filter(item => item.date !== '待定');
            
            console.log(`DEBUG: 过滤后有效打新数据: ${validData.length} 条`);
            return validData;
        } else {
            console.warn("WARNING: API返回数据为空");
            return [];
        }
    } catch (error) {
        console.error("ERROR: API调用失败:", error.message);
        return [];
    }
}

// 更新HTML文件中的数据
async function updateHtmlFile(ipoData) {
    const indexPath = path.join(__dirname, '../index.html');
    let htmlContent = fs.readFileSync(indexPath, 'utf8');
    
    // 如果没有数据，保持原样或写入空数组，这里我们写入空数组以清空旧的模拟数据
    // 同时也把更新时间刷新一下
    const newDataSection = `const mockIpoData = ${JSON.stringify(ipoData, null, 4)};`;
    
    const updatedHtml = htmlContent.replace(
        /(const mockIpoData = )\[([^\]]*?)\];/s,
        newDataSection
    ).replace(
        /更新时间：[^<]*<\/span>/,
        `更新时间：${new Date().toLocaleString('zh-CN')} (自动更新)</span>`
    );

    fs.writeFileSync(indexPath, updatedHtml, 'utf8');
    console.log(`SUCCESS: HTML文件已更新`);
}

// 主函数
async function main() {
    try {
        const ipoData = await fetchIpoDataFromTushare();
        await updateHtmlFile(ipoData);
    } catch (error) {
        console.error("Critical Error:", error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
