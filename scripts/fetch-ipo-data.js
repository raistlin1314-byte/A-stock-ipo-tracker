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
        const startDate = formatDateForTushare(new Date()); // 今天
        const endDate = formatDateForTushare(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 未来30天
        
        console.log(`DEBUG: 正在请求 Tushare API...`);
        console.log(`DEBUG: 日期范围: ${startDate} 到 ${endDate}`);

        // 调用Tushare API
        const response = await axios.post('http://api.tushare.pro', {
            api_name: 'new_share',
            token: token,
            params: {
                start_date: startDate,
                end_date: endDate
            },
            fields: 'ts_code,name,ipo_date,issue_date,amount,market,price,pe,limit_amount,funds,ballot' 
        });

        // --- 关键调试步骤：打印 API 返回的原始数据 ---
        // 这样在 GitHub Actions 的日志里就能看到 Tushare 到底给了什么
        console.log("DEBUG: Tushare 原始返回结果:", JSON.stringify(response.data)); 

        if (response.data?.data?.items && Array.isArray(response.data.data.items)) {
            const rawData = response.data.data.items;
            console.log(`DEBUG: 获取到 ${rawData.length} 条原始数据`);

            // 转换数据格式
            const transformedData = rawData.map(item => {
                // Tushare new_share 接口字段映射
                // 注意：不同接口字段名可能不同，这里以 new_share 标准字段为准
                return {
                    name: item.name || '未知',
                    code: item.ts_code ? item.ts_code.split('.')[0] : '未知',
                    date: formatTushareDateToDisplay(item.ipo_date), // 申购日期
                    market: item.market || 'A股',
                    price: item.price ? parseFloat(item.price) : null,
                    maxSubscription: item.limit_amount ? parseInt(item.limit_amount * 10000) : 0, // 假如单位是万股
                    requiredMarketValue: { shanghai: 0, shenzhen: 0 }, // Tushare不直接返回市值要求，暂置0
                    industry: '待定', // new_share 基础接口可能不含行业，需额外获取或置空
                    peRatio: item.pe ? parseFloat(item.pe) : '待定',
                    expectedFundraise: item.funds ? item.funds + '亿' : '待定',
                    listingDate: formatTushareDateToDisplay(item.issue_date)
                };
            });

            // 过滤掉日期为空的（还没定申购日的）
            const validData = transformedData.filter(item => item.date !== '待定');
            
            console.log(`DEBUG: 过滤后有效打新数据: ${validData.length} 条`);
            return validData;
        } else {
            console.warn("WARNING: API返回数据为空或格式不符");
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
    
    // 如果没有数据，不要清空页面，保留旧数据或者写入空数组
    // 这里我们选择写入真实数据（即使是空的，表示近期确实无申购）
    
    let htmlContent = fs.readFileSync(indexPath, 'utf8');
    
    // 构造新的数据字符串
    const newDataSection = `const mockIpoData = ${JSON.stringify(ipoData, null, 4)};`;
    
    // 替换 HTML 中的 mockIpoData
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
        
        // 只有当获取到数据，或者确认API调用成功但无数据时才更新
        await updateHtmlFile(ipoData);
        
    } catch (error) {
        console.error("Critical Error:", error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

