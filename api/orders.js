fetch('/api/orders?debug=11488', {
  headers: { 'Authorization': 'Bearer ' + API_TOKEN }
}).then(r => r.json()).then(d => {
  console.log('number:', d.raw?.number)
  console.log('name:', d.raw?.billingInfo?.contactDetails)
  console.log('createdDate:', d.raw?.createdDate)
})
Promise {<pending>}
VM35:4 number: 11492
VM35:5 name: {firstName: 'Elijah', lastName: 'Johnson', phone: '2016372010'}
VM35:6 createdDate: 2026-03-27T14:23:58.113Z
