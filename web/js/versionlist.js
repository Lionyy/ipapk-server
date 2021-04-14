
var reg_url = /^[^\?]+\?([\w\W]+)$/,
reg_para = /([^&=]+)=([\w\W]*?)(&|$|#)/g,
arr_url = reg_url.exec(window.location.href),
query = {};
if (arr_url && arr_url[1]) {
	var str_para = arr_url[1], result;
	while ((result = reg_para.exec(str_para)) != null) {
		query[result[1]] = result[2];
	}
}

var main = new Vue({
	el: '.platform_wrapper',
	data: {
		selected_paltform: query.platform,
		bundle_id: query.bundleID,
		page: 1,
		apps: [],
		show_load_more_apps_button: true,
	},
	methods: {
		loadApps: function () {
			axios.get("/apps/"+this.selected_paltform+"/"+this.bundle_id+"/"+this.page).then(response => {
	            this.apps = this.apps.concat(response.data)
	            this.page++
	            this.show_load_more_apps_button = response.data.length > 0

	            this.apps.forEach((item, index) => {
	            	item.isExpand = false
	            	item.needShowExpand = false
	            })

				console.log('apps = ' + this.apps)

	            // 展开收起
				this.$nextTick(() => {
					/* 获取文本所在的div */
					let changelogDoms = this.$refs.changelog
					console.log('changelogDoms = ' + changelogDoms)

					changelogDoms.forEach((item, index) => {
	            		let app = this.apps[index]
	            		console.log(item)
						let lineHeight = 22
						let height = item.offsetHeight;
						console.log('height = ' + height)
						if (height > lineHeight * 2) {
							app.isExpand = false
							app.needShowExpand = true
						} else {
							app.needShowExpand = false
						}
						let indexOfApp = this.apps.indexOf(app)
						Vue.set(this.apps, indexOfApp, app)
						console.log('app.needShowExpand = ' + app.needShowExpand)
	            	})
				})
	        });
		},
		expandClick: function(app) {
			app.isExpand = !app.isExpand
			let indexOfApp = this.apps.indexOf(app)
			Vue.set(this.apps, indexOfApp, app)
			console.log('app.guid = ' + app.guid)
		},
	},
	computed: {
		has_data: function () {
			return this.apps.length > 0
		},
		// isExpand: function (app) {
		// 	return app.isExpand
		// },
		// needShowExpand: function (app) {
		// 	return app.needShowExpand
		// },
	},
});

main.loadApps()

