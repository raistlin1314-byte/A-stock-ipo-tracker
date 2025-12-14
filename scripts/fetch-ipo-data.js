// scripts/fetch-ipo-data.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ================= 配置区域 =================
// ⚠️ 请在这里填入你在 PushPlus 创建的【群组编码】
const PUSHPLUS_TOPIC = 'ipo_team'; 
// 例如: const PUSHPLUS_TOPIC = 'ipo_team';
// ===========================================

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

// --- 核心功能：发送微信群组推送 ---
async function sendWeChatNotification(ipoData) {
    const token = process.env.PUSHPLUS_TOKEN;
    if (!token) {
        console.log("提示: 未配置 PUSHPLUS_TOKEN，跳过微信推送");
        return;
    }

    if (ipoData.length === 0) {
        console.log("提示: 无新股数据，跳过微信推送");
        return;
    }

    // 1. 准备消息标题
    const title = `【打新提醒】发现 ${ipoData.length} 只新股申购`;

    // 2. 准备消息内容 (Markdown格式)
    let content = `### 📅 未来30天新股申购清单\n\n`;
    content += `| 申购日 | 名称 | 代码 | 价格 |\n`;
    content += `| :--- | :--- | :--- | :--- |\n`;

    // 按日期排序，最近的在前面
    const sortedData = [...ipoData].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedData.forEach(item => {
        const priceStr = item.price ? `${item.price}元` : '待定';
        // 对当天申购的新股加粗显示
        const todayStr = new Date().toISOString().split('T')[0];
        const nameDisplay = item.date === todayStr ? `🔴 **${item.name}**` : `**${item.name}**`;
        
        content += `| ${item.date} | ${nameDisplay} | ${item.code} | ${priceStr} |\n`;
    });

    content += `\n> 更新时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
    content += `> [点击进入打新日历网页](https://raistlin1314-byte.github.io/A-stock-ipo-tracker/)\n`;
    content += `> *请以券商实际申购信息为准*`;

    // 3. 发送请求给 PushPlus (一对多模式)
    try {
        console.log(`正在发送微信推送 (群组: ${PUSHPLUS_TOPIC})...`);
        
        const payload = {
            token: token,
            title: title,
            content: content,
            template: 'markdown',
            topic: PUSHPLUS_TOPIC // 这里使用了你设置的群组编码
        };

        const response = await axios.post('http://www.pushplus.plus/send', payload);

        if (response.data && response.data.code === 200) {
            console.log("✅ 微信推送成功！");
        } else {
            console.error("❌ 微信推送失败:", response.data);
        }
    } catch (error) {
        console.error("❌ 推送请求出错:", error.message);
    }
}

// 使用Tushare API获取数据
async function fetchIpoDataFromTushare() {
    const token = process.env.TUSHARE_TOKEN;
    if (!token) {
        throw new Error("Tushare Token未配置");
    }

    try {
        const startDate = formatDateForTushare(new Date()); 
        const endDate = formatDateForTushare(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); 
        
        console.log(`DEBUG: 正在请求 Tushare API...`);

        // 使用 http 避免 SSL 错误
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
            const fields = response.data.data.fields;
            
            console.log(`DEBUG: 获取到 ${rawItems.length} 条原始数据`);

            const transformedData = rawItems.map(itemArray => {
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

            // 过滤并按日期排序
            const validData = transformedData
                .filter(item => item.date !== '待定');
            
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
    
    // 如果没有数据，依然更新时间，但不清空mockData以免页面难看，或者写入空数组
    // 这里写入实际数据
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
        
        // 1. 更新网页
        await updateHtmlFile(ipoData);

        // 2. 发送微信推送
        await sendWeChatNotification(ipoData);
        
    } catch (error) {
        console.error("Critical Error:", error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
