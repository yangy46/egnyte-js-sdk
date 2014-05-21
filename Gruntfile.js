module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),
        clean: ["dist"],
        browserify: {
            dist: {
                files: {
                    "dist/egnyte.js": ["src/egnyte.js"],
                    "dist/slim.js": ["src/slim.js"]
                },
                options: {
                    transform: ['grunt-less-browserify']
                }
            }
        },
        uglify: {
            options: {
                banner: "// <%= pkg.name %> v<%= pkg.version %> (<%= grunt.template.today('yyyy-mm-dd') %>) \n" +
                    "// license:<%= pkg.license %> \n" +
                    "// <%= pkg.author %> \n"
            },
            dist: {
                files: [{
                    src: 'dist/*.js', // source files mask
                    dest: 'dist/', // destination folder
                    expand: true, // allow dynamic building
                    flatten: true, // remove all unnecessary nesting
                    ext: '.min.js' // replace .js to .min.js
                }]
            }
        },

        jasmine: {
            all: {
                src: ["dist/egnyte.js", "spec/conf/apiaccess.js"],
                options: {
                    keepRunner: true,
                    specs: 'spec/*.js',
                    '--web-security': false,
                    '--local-to-remote-url-access': true,
                    '--ignore-ssl-errors': true
                }
            }
        },

        watch: {
            files: ["src/**/*.js","src/**/*.less"],
            tasks: ["dist"]
        }
    })
    grunt.loadNpmTasks("grunt-browserify");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks('grunt-contrib-jasmine');


    grunt.registerTask("test", ["dist", "jasmine:all"]);
    grunt.registerTask("dist", ["clean", "browserify", "uglify"]);

    grunt.registerTask("default", ["test"]);
}